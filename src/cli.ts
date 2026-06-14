/**
 * `clipia` command-line interface, built on top of the SDK.
 *
 * Auth resolves from the `--key` flag or the `CLIPIA_KEY` environment variable.
 * All commands print JSON to stdout. No emoji per project conventions.
 */

import { Command, type OptionValues } from 'commander';

import { ClipiaApiError, createClient, type ClipiaClient } from './index.js';

interface GlobalOpts extends OptionValues {
  key?: string;
  baseUrl?: string;
  json?: boolean;
}

let warnedAboutKeyFlag = false;

function resolveClient(opts: GlobalOpts): ClipiaClient {
  if (opts.key && !warnedAboutKeyFlag) {
    warnedAboutKeyFlag = true;
    process.stderr.write(
      'Warning: passing --key via argv is visible in process list; prefer CLIPIA_KEY env var.\n',
    );
  }
  const apiKey = opts.key ?? process.env['CLIPIA_KEY'];
  if (!apiKey) {
    fail('No API key. Pass --key or set the CLIPIA_KEY environment variable.');
  }
  return createClient({ apiKey: apiKey!, baseUrl: opts.baseUrl });
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

function handleError(err: unknown): never {
  if (err instanceof ClipiaApiError) {
    fail(`[${err.status} ${err.code}] ${err.message}`);
  }
  if (err instanceof Error) {
    fail(err.message);
  }
  fail(String(err));
}

function parseInput(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(
      `--input must be valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('--input must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const program = new Command();

program
  .name('clipia')
  .description('Command-line client for the Clipia public API.')
  .option(
    '--key <key>',
    'API key (overrides CLIPIA_KEY env var; insecure on shared hosts — visible in the process list, prefer CLIPIA_KEY)',
  )
  .option('--base-url <url>', 'override the API base URL')
  .allowExcessArguments(false);

program
  .command('generate')
  .description('Submit a generation to the queue')
  .argument('<model>', 'model slug, e.g. nano-banana-2')
  .requiredOption('--input <json>', 'generation input as a JSON object')
  .option('--webhook <url>', 'webhook URL for completion notification')
  .option('--wait', 'poll until the generation reaches a terminal status')
  .action(async (model: string, cmdOpts: OptionValues, command: Command) => {
    const globalOpts = command.optsWithGlobals() as GlobalOpts;
    const client = resolveClient(globalOpts);
    const input = parseInput(cmdOpts['input'] as string);
    const webhookUrl = cmdOpts['webhook'] as string | undefined;

    try {
      if (cmdOpts['wait']) {
        const result = await client.subscribe(model, {
          input,
          webhookUrl,
          onQueueUpdate: (s) => {
            process.stderr.write(
              `status: ${s.status}${
                s.progress != null ? ` (${s.progress}%)` : ''
              }\n`,
            );
          },
        });
        printJson(result);
      } else {
        const submitted = await client.queue.submit(model, {
          input,
          webhookUrl,
        });
        printJson(submitted);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('status')
  .description('Get the status of a request')
  .argument('<request_id>', 'request id returned by generate')
  .action(async (requestId: string, _cmdOpts: OptionValues, command: Command) => {
    const client = resolveClient(command.optsWithGlobals() as GlobalOpts);
    try {
      printJson(await client.queue.status(requestId));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('result')
  .description('Get the result of a request')
  .argument('<request_id>', 'request id returned by generate')
  .action(async (requestId: string, _cmdOpts: OptionValues, command: Command) => {
    const client = resolveClient(command.optsWithGlobals() as GlobalOpts);
    try {
      printJson(await client.queue.result(requestId));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('estimate')
  .description('Estimate the credit cost of an input for a model')
  .argument('<model>', 'model slug, e.g. nano-banana-2')
  .requiredOption('--input <json>', 'generation input as a JSON object')
  .action(async (model: string, cmdOpts: OptionValues, command: Command) => {
    const client = resolveClient(command.optsWithGlobals() as GlobalOpts);
    const input = parseInput(cmdOpts['input'] as string);
    try {
      printJson(await client.models.estimate(model, input));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('models')
  .description('List models, or show one model with a slug argument')
  .argument('[slug]', 'optional model slug for details')
  .action(async (slug: string | undefined, _cmdOpts: OptionValues, command: Command) => {
    const client = resolveClient(command.optsWithGlobals() as GlobalOpts);
    try {
      if (slug) {
        printJson(await client.models.get(slug));
      } else {
        printJson(await client.models.list());
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('account')
  .description('Show account balance and 30-day usage')
  .action(async (_cmdOpts: OptionValues, command: Command) => {
    const client = resolveClient(command.optsWithGlobals() as GlobalOpts);
    try {
      printJson(await client.account.get());
    } catch (err) {
      handleError(err);
    }
  });

program.parseAsync(process.argv).catch(handleError);
