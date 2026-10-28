#!/usr/bin/env node
// Validate one extension folder: manifest parses, every file it references exists.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] || ".");
const manifestPath = join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`::error::no manifest.json in ${dir}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];
const refs = [];

const PATH_LIKE = /^[\w.@/-]+\.(js|css|json|html|png|svg|gif|woff2?)$/;
const collect = (value, trail) => {
  if (typeof value === "string") {
    if (PATH_LIKE.test(value)) refs.push({ file: value, where: trail });
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => collect(v, `${trail}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collect(v, `${trail}.${k}`);
  }
};
collect(manifest, "manifest");

for (const { file, where } of refs) {
  if (file.includes("..")) errors.push(`${where}: "${file}" escapes the extension folder`);
  else if (!existsSync(join(dir, file))) errors.push(`${where}: referenced file missing -> ${file}`);
}

for (const key of ["manifest_version", "name", "version"]) {
  if (manifest[key] === undefined) errors.push(`manifest: required "${key}" missing`);
}
if (manifest.manifest_version !== 3) errors.push(`manifest: manifest_version is ${manifest.manifest_version}, expected 3`);

// Rulesets Chrome must be able to load, plus their rule counts.
const rulesets = manifest?.declarative_net_request?.rule_resources || [];
const report = [];
for (const r of rulesets) {
  const abs = join(dir, r.path);
  if (!existsSync(abs)) {
    errors.push(`ruleset ${r.id}: file missing -> ${r.path}`);
    continue;
  }
  const rules = JSON.parse(readFileSync(abs, "utf8"));
  if (!Array.isArray(rules)) {
    errors.push(`ruleset ${r.id}: not a JSON array`);
    continue;
  }
  const bad = rules.findIndex((x) => typeof x?.id !== "number" || typeof x?.action?.type !== "string" || !x.condition);
  if (bad !== -1) errors.push(`ruleset ${r.id}: entry ${bad} needs numeric id, action.type and condition`);
  const ids = new Set(rules.map((x) => x.id));
  if (ids.size !== rules.length) {
    errors.push(`ruleset ${r.id}: ${rules.length - ids.size} duplicate rule id(s), Chrome rejects these`);
  }
  report.push({ id: r.id, rules: rules.length, bytes: statSync(abs).size });
}

const walk = (d) => readdirSync(d, { withFileTypes: true })
  .reduce((t, e) => t + (e.isDirectory() ? walk(join(d, e.name)) : statSync(join(d, e.name)).size), 0);

if (errors.length) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}

const total = walk(dir);
console.log(`${manifest.name} v${manifest.version} — ${refs.length} referenced files present, no missing paths`);
for (const r of report) {
  console.log(`  ruleset ${r.id}: ${r.rules} rules, ${(r.bytes / 1048576).toFixed(2)} MB`);
}
console.log(`  package size: ${(total / 1048576).toFixed(2)} MB`);
