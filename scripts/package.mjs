// Build the Chrome Web Store upload: dist/lupax-<version>.zip with manifest.json at its root and only the files the
// extension loads (no tests, tooling, docs or dotfiles). Uses git's file list, so untracked files never slip in.
// Usage: npm run package
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../lib/zip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIP_DIRS = ['content/', 'fonts/', 'icons/', 'lib/', 'popup/', 'styles/'];
const isShipped = (f) => !f.split('/').some((p) => p.startsWith('.'))
  && (['manifest.json', 'LICENSE', 'NOTICE'].includes(f) || /^[^/]+\.(html|js)$/.test(f) || SHIP_DIRS.some((d) => f.startsWith(d)));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = tracked.filter(isShipped).filter((f) => existsSync(join(root, f))).sort();

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
// everything the manifest names must be in the package, or Chrome rejects the upload
const named = [manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_page,
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})].filter(Boolean);
const missing = named.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`Not in the package (untracked or excluded): ${missing.join(', ')}`);
  process.exit(1);
}
// license files that must ship: Apache-2.0 requires LICENSE and NOTICE in redistributions, OFL requires its text
const required = ['LICENSE', 'NOTICE', 'fonts/OFL.txt'].filter((f) => !files.includes(f));
if (required.length) {
  console.error(`License files missing from the package (untracked?): ${required.join(', ')}`);
  process.exit(1);
}

const zip = makeZip(files.map((name) => ({ name, data: new Uint8Array(readFileSync(join(root, name))) })));
const out = join(root, 'dist', `lupax-${manifest.version}.zip`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, new Uint8Array(await zip.arrayBuffer()));
console.log(`${out.slice(root.length + 1)}: ${files.length} files, ${(zip.size / 1024).toFixed(0)} KB`);
