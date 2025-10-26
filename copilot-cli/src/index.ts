#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startWatcher } from './watcher';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <directory> [options]')
  .command('$0 <directory>', 'Watch a directory for file changes', (yargs: any) => {
    return yargs.positional('directory', {
      describe: 'Directory path to watch',
      type: 'string',
      demandOption: true,
    });
  })
  .option('server-url', {
    alias: 's',
    type: 'string',
    description: 'Backend server URL',
    default: 'http://localhost:3001',
  })
  .example('$0 ./src', 'Watch the src directory')
  .example('$0 ./src --server-url http://localhost:3001', 'Watch src with custom server URL')
  .help()
  .alias('help', 'h')
  .version('1.0.0')
  .alias('version', 'v')
  .parseSync();

async function main() {
  const directory = argv.directory as string;
  const serverUrl = argv['server-url'] as string;

  try {
    await startWatcher(directory, serverUrl);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
