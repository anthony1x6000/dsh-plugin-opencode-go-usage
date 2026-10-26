#!/usr/bin/env node
/**
 * Package validation for `dsh-plugin-opencode-go-usage`.
 *
 * Runs offline and prints one line per check. Non-zero exit means a packaging
 * defect that would either break the DSH loader or publish an unusable tarball.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(label, fn) {
  try {
    const detail = fn();
    console.log(`ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures.push(label);
    console.log(`FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

let manifest;
check('package.json parses', () => {
  manifest = readJson('package.json');
  return `${manifest.name}@${manifest.version}`;
});

check('manifest fields', () => {
  const required = ['name', 'version', 'license', 'exports', 'files', 'dsh'];
  for (const field of required) {
    if (manifest[field] === undefined) throw new Error(`missing "${field}"`);
  }
  if (!manifest.exports['./client']) throw new Error('exports["./client"] is required for the browser half');
  if (!manifest.exports['./locale/*.json']) throw new Error('exports["./locale/*.json"] is required for display metadata');
  if (!manifest.exports['./icon']) throw new Error('exports["./icon"] is required for the plugin icon');
  if (manifest.dsh.bundle?.patch === undefined) throw new Error('dsh.bundle.patch is required');
  if (manifest.dsh.client?.platform !== 'web') throw new Error('dsh.client.platform must be "web"');
  return manifest.name;
});

check('runtime files listed in "files"', () => {
  const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg'];
  for (const file of required) {
    if (!manifest.files.some((entry) => entry === file || entry.startsWith(file))) {
      throw new Error(`"files" does not cover ${file}`);
    }
  }
  if (!manifest.files.some((entry) => entry.startsWith('locale/'))) throw new Error('"files" does not cover locale/*.json');
  return manifest.files.length + ' entries';
});

check('host and client syntax', () => {
  for (const file of ['index.js', 'client.js']) {
    execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' });
  }
  return 'node --check passed';
});

check('cordis patch inserts this package', () => {
  const patch = readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8');
  if (!patch.includes(manifest.name)) throw new Error(`patch does not reference ${manifest.name}`);
  return manifest.dsh.bundle.patch;
});

check('client module id equals the package name', () => {
  const client = readFileSync(join(root, 'client.js'), 'utf8');
  if (!client.includes(`id: '${manifest.name}'`)) throw new Error(`client.js must register id: '${manifest.name}'`);
  return manifest.name;
});

check('locale metadata', () => {
  for (const locale of ['en', 'zh']) {
    const dictionary = readJson(`locale/${locale}.json`);
    if (!dictionary.meta?.title) throw new Error(`locale/${locale}.json meta.title is empty`);
    if (!dictionary.meta?.description) throw new Error(`locale/${locale}.json meta.description is empty`);
  }
  return 'en + zh';
});

check('icon', () => {
  const path = join(root, 'icon.svg');
  const size = statSync(path).size;
  const head = readFileSync(path, 'utf8').trimStart();
  if (size > 256 * 1024) throw new Error(`icon.svg is ${size} bytes (limit 256 KiB)`);
  if (!head.startsWith('<svg')) throw new Error('icon.svg is not an SVG document');
  return `${size} bytes`;
});

check('client CSS uses theme tokens only', () => {
  const client = readFileSync(join(root, 'client.js'), 'utf8');
  const css = client.slice(client.indexOf('const CSS = `'), client.indexOf('\n`;', client.indexOf('const CSS = `')));
  const literalColors = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/g) ?? [];
  if (literalColors.length > 0) throw new Error(`literal colors in plugin CSS: ${[...new Set(literalColors)].join(', ')}`);
  return 'no literal colors';
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
