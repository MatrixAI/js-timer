import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit unreleased-provider lane. Never changes the checkout's installed
// packages, canonical manifests, lock, or normal producer-selection authority.
const root = fileURLToPath(new URL('../', import.meta.url));
const [archiveArgument, ...arguments_] = process.argv.slice(2);
const options = [];
let lifecycleRoot;
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === '--browser') options.push(argument);
  else if (argument === '--lifecycle-root' && arguments_[index + 1]) {
    lifecycleRoot = path.resolve(arguments_[++index]);
  } else throw new Error(`Unknown or incomplete candidate option: ${argument}`);
}
assert(archiveArgument,
  'Usage: npm run check:candidate -- /absolute/provider.tgz [--browser] [--lifecycle-root /absolute/checkout]');
const archive = path.resolve(archiveArgument);
const bytes = await readFile(archive);
const beforeManifest = await readFile(path.join(root, 'package.json'), 'utf8');
const beforeLock = await readFile(path.join(root, 'package-lock.json'), 'utf8');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const world = await mkdtemp(path.join(root, 'tmp/cancellation-candidate-'));
for (const entry of [
  'src', 'tests', 'scripts', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.build.json', 'jest.config.mjs', 'LICENSE', 'README.md',
]) {
  await cp(path.join(root, entry), path.join(world, entry), { recursive: true });
}
const modules = path.join(world, 'node_modules');
await mkdir(path.join(modules, '@matrixai'), { recursive: true });
for (const entry of await readdir(path.join(root, 'node_modules'))) {
  if (entry === '@matrixai') continue;
  await symlink(path.join(root, 'node_modules', entry), path.join(modules, entry));
}
for (const entry of await readdir(path.join(root, 'node_modules/@matrixai'))) {
  if (entry === 'async-cancellable') continue;
  await cp(path.join(root, 'node_modules/@matrixai', entry), path.join(modules, '@matrixai', entry), {
    recursive: true, dereference: true,
  });
}
const candidate = path.join(modules, '@matrixai/async-cancellable');
await mkdir(candidate);
execFileSync('tar', ['-xzf', archive, '-C', candidate, '--strip-components=1']);
const provider = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
assert.equal(provider.name, '@matrixai/async-cancellable');
const manifest = JSON.parse(beforeManifest);
const lock = JSON.parse(beforeLock);
// This generated world explicitly substitutes an artifact, not a released
// coordinate. Only its local packed-consumer closure needs this synthetic edge.
manifest.dependencies[provider.name] = provider.version;
lock.packages[''].dependencies[provider.name] = provider.version;
lock.packages['node_modules/@matrixai/async-cancellable'] = {
  version: provider.version,
  resolved: `file:${archive}`,
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  dependencies: provider.dependencies,
  engines: provider.engines,
};
await writeFile(path.join(world, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(world, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
let lifecycleArchive;
if (lifecycleRoot != null) {
  const directory = path.join(lifecycleRoot, 'tmp/package-candidate');
  const archives = (await readdir(directory)).filter((entry) => entry.endsWith('.tgz'));
  assert.equal(archives.length, 1, 'Run the lifecycle packed-package check first');
  lifecycleArchive = path.join(directory, archives[0]);
  const installed = path.join(modules, '@matrixai/async-init');
  await mkdir(installed, { recursive: true });
  execFileSync('tar', ['-xzf', lifecycleArchive, '-C', installed, '--strip-components=1']);
  assert.equal(await readFile(path.join(installed, 'package.json'), 'utf8'),
    await readFile(path.join(lifecycleRoot, 'package.json'), 'utf8'));
  const lifecycleLock = JSON.parse(await readFile(path.join(lifecycleRoot, 'package-lock.json'), 'utf8'));
  // Preserve the existing provider's exact dependency scopes. In particular,
  // its legacy locks must not accidentally resolve our new cancellation API.
  for (const [modulePath, dependency] of Object.entries(lifecycleLock.packages)) {
    if (!modulePath.startsWith('node_modules/') || dependency.dev === true) continue;
    try {
      await cp(path.join(lifecycleRoot, modulePath), path.join(installed, modulePath), {
        recursive: true, dereference: true,
      });
    } catch (error) {
      if (dependency.optional !== true || error.code !== 'ENOENT') throw error;
    }
  }
}
const report = {
  schemaVersion: 1,
  kind: 'unreleased-provider-integration',
  status: 'failed',
  world,
  archive,
  archiveSha256: createHash('sha256').update(bytes).digest('hex'),
  lifecycleArchive,
  lifecycleArchiveSha256: lifecycleArchive == null ? undefined :
    createHash('sha256').update(await readFile(lifecycleArchive)).digest('hex'),
  providerCases: [],
  canonicalDependencySelection: 'not-verified-by-this-lane',
  release: 'not-authorized',
};
try {
  execFileSync('npm', ['run', 'check:conformance'], { cwd: world, stdio: 'inherit', timeout: 180000 });
  if (lifecycleArchive != null) {
    const consumer = path.join(world, 'tmp/package-candidate/consumer');
    await cp(path.join(modules, '@matrixai/async-init'), path.join(consumer, 'node_modules/@matrixai/async-init'), {
      recursive: true, dereference: true,
    });
    await cp(path.join(world, 'tests/fixtures/providers/lifecycle.mjs'), path.join(consumer, 'lifecycle.mjs'));
    execFileSync(process.execPath, ['lifecycle.mjs'], { cwd: consumer, stdio: 'inherit', timeout: 20000 });
    report.providerCases = [
      'CASE-PROVIDERS-LIFECYCLE-DRAIN',
      'CASE-PROVIDERS-LIFECYCLE-RACE',
      'CASE-PROVIDERS-LIFECYCLE-STOP',
    ];
  }
  if (options.includes('--browser')) {
    execFileSync('npm', ['run', 'test:browser'], { cwd: world, stdio: 'inherit', timeout: 180000 });
  }
  report.status = 'passed';
} finally {
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), beforeManifest);
  assert.equal(await readFile(path.join(root, 'package-lock.json'), 'utf8'), beforeLock);
  await writeFile(path.join(world, 'candidate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Retained candidate world: ${world}`);
}
