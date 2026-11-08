// Cross-platform helper for the Python intelligence service.
//   node scripts/intel.mjs setup   -> create .venv with a supported Python (3.11-3.13) and install deps
//   node scripts/intel.mjs run     -> start uvicorn on :8000
//   node scripts/intel.mjs test    -> run pytest
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svc = join(root, 'services', 'intelligence');
const win = process.platform === 'win32';
const venvPy = join(svc, '.venv', win ? 'Scripts/python.exe' : 'bin/python');

function findPython() {
  // ML wheels (xgboost, numpy) lag behind the newest Python, so prefer 3.12 -> 3.11 -> 3.13.
  const candidates = win
    ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['python', []]]
    : [['python3.12', []], ['python3.11', []], ['python3.13', []], ['python3', []]];
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[:2])'], { encoding: 'utf8' });
    if (r.status === 0) return [cmd, args];
  }
  throw new Error('No Python 3.11-3.13 found. Install one from python.org (free).');
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: svc, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const action = process.argv[2];
if (action === 'setup') {
  if (!existsSync(venvPy)) {
    const [cmd, args] = findPython();
    console.log(`Creating venv with ${cmd} ${args.join(' ')}`);
    run(cmd, [...args, '-m', 'venv', '.venv']);
  }
  run(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip', '-q']);
  run(venvPy, ['-m', 'pip', 'install', '-r', 'requirements.txt', '-q']);
  run(venvPy, ['-m', 'app.risk.train']);
} else if (action === 'run' || action === 'test') {
  if (!existsSync(venvPy)) {
    console.error('Run `npm run setup:intel` first.');
    process.exit(1);
  }
  if (action === 'test') run(venvPy, ['-m', 'pytest', '-q']);
  else {
    const p = spawn(venvPy, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', process.env.INTEL_PORT ?? '8000'], { stdio: 'inherit', cwd: svc });
    p.on('exit', (code) => process.exit(code ?? 0));
  }
} else {
  console.log('usage: node scripts/intel.mjs setup|run|test');
}
