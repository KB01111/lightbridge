import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const appBinary = resolve('src-tauri/target/debug/lightbridge.exe');
const dataDirectory = join(tmpdir(), 'lightbridge-wdio');
const localDriverDirectory = resolve('.codex-local/msedgedriver');
let tauriDriver: ChildProcess | undefined;

process.env.LIGHTBRIDGE_E2E = '1';
process.env.LIGHTBRIDGE_E2E_DATA_DIR = dataDirectory;
if (existsSync(join(localDriverDirectory, 'msedgedriver.exe'))) {
  process.env.PATH = `${localDriverDirectory}${delimiter}${process.env.PATH ?? ''}`;
}

function stopDriver() {
  tauriDriver?.kill();
  tauriDriver = undefined;
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  host: '127.0.0.1',
  port: 4444,
  specs: ['./e2e/specs/**/*.spec.ts'],
  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: appBinary,
      },
    },
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },
  onPrepare() {
    rmSync(dataDirectory, { recursive: true, force: true });
    if (existsSync(appBinary)) return;
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(
      pnpm,
      ['exec', 'tauri', 'build', '--debug', '--no-bundle'],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      },
    );
    if (result.status !== 0) {
      throw new Error('Tauri debug build failed before WebDriver acceptance.');
    }
  },
  beforeSession() {
    const executable =
      process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver';
    tauriDriver = spawn(executable, [], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    tauriDriver.on('error', (error) => {
      throw error;
    });
  },
  afterSession() {
    stopDriver();
  },
  onComplete() {
    stopDriver();
  },
};
