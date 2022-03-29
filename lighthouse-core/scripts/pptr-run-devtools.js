/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * USAGE:
 * Make sure CHROME_PATH is set to a modern version of Chrome.
 * May work on older versions of Chrome.
 *
 * To use with locally built DevTools and Lighthouse, run (assuming devtools at ~/src/devtools/devtools-frontend):
 *    yarn devtools
 *    yarn run-devtools --chrome-flags=--custom-devtools-frontend=file://$HOME/src/devtools/devtools-frontend/out/Default/gen/front_end
 *
 * Or with the DevTools in .tmp:
 *   bash lighthouse-core/test/chromium-web-tests/setup.sh
 *   yarn run-devtools --chrome-flags=--custom-devtools-frontend=file://$PWD/.tmp/chromium-web-tests/devtools/devtools-frontend/out/Default/gen/front_end
 *
 * URL list file: yarn run-devtools < path/to/urls.txt
 * Single URL: yarn run-devtools "https://example.com"
 */

import fs from 'fs';
import readline from 'readline';
import {fileURLToPath} from 'url';

import puppeteer from 'puppeteer-core';
import yargs from 'yargs';
import * as yargsHelpers from 'yargs/helpers';

import {parseChromeFlags} from '../../lighthouse-cli/run.js';

const y = yargs(yargsHelpers.hideBin(process.argv));
const argv_ = y
  .usage('$0 [url]')
  .help('help').alias('help', 'h')
  .option('_', {type: 'string'})
  .option('output-dir', {
    type: 'string',
    default: 'latest-run/devtools-lhrs',
    alias: 'o',
  })
  .option('chrome-flags', {
    type: 'string',
    default: '',
  })
  .option('config', {
    type: 'string',
    alias: 'c',
  })
  .argv;

const argv = /** @type {Awaited<typeof argv_>} */ (argv_);
/** @type {LH.Config.Json=} */
const config = argv.config ? JSON.parse(argv.config) : undefined;

/**
 * https://source.chromium.org/chromium/chromium/src/+/main:third_party/devtools-frontend/src/front_end/test_runner/TestRunner.js;l=170;drc=f59e6de269f4f50bca824f8ca678d5906c7d3dc8
 * @param {Record<string, function>} receiver
 * @param {string} methodName
 * @param {function} override
 */
function addSniffer(receiver, methodName, override) {
  const original = receiver[methodName];
  if (typeof original !== 'function') {
    throw new Error('Cannot find method to override: ' + methodName);
  }

  /**
   * @param  {...any} args
   */
  receiver[methodName] = function(...args) {
    let result;
    try {
      result = original.apply(this, args);
    } finally {
      receiver[methodName] = original;
    }
    // In case of exception the override won't be called.
    try {
      Array.prototype.push.call(args, result);
      override.apply(this, args);
    } catch (e) {
      throw new Error('Exception in overriden method \'' + methodName + '\': ' + e);
    }
    return result;
  };
}

const sniffLhr = `
new Promise(resolve => {
  const panel = UI.panels.lighthouse || UI.panels.audits;
  const methodName = panel.__proto__.buildReportUI ?
    'buildReportUI' : '_buildReportUI';
  (${addSniffer.toString()})(
    panel.__proto__,
    methodName,
    (lhr, artifacts) => resolve({lhr, artifacts})
  );
});
`;

const sniffLighthouseStarted = `
new Promise(resolve => {
  const panel = UI.panels.lighthouse || UI.panels.audits;
  const protocolService = panel.protocolService || panel._protocolService;
  const functionName = protocolService.__proto__.startLighthouse ?
    'startLighthouse' :
    'collectLighthouseResults';
  (${addSniffer.toString()})(
    protocolService.__proto__,
    functionName,
    (inspectedURL) => resolve(inspectedURL)
  );
});
`;

const startLighthouse = `
(async () => {
  const viewManager = UI.viewManager || (UI.ViewManager.ViewManager || UI.ViewManager).instance();
  const views = viewManager.views || viewManager._views;
  const panelName = views.has('lighthouse') ? 'lighthouse' : 'audits';
  await viewManager.showView(panelName);

  const panel = UI.panels.lighthouse || UI.panels.audits;
  const button = panel.contentElement.querySelector('button');
  if (button.disabled) throw new Error('Start button disabled');

  UI.dockController.setDockSide('undocked');

  // Give the main target model a moment to be available.
  // Otherwise, 'SDK.TargetManager.TargetManager.instance().mainTarget()' is null.
  if (self.runtime && self.runtime.loadLegacyModule) {
    // This exposes TargetManager via self.SDK.
    try {
      await self.runtime.loadLegacyModule('core/sdk/sdk-legacy.js');
    } catch {}
  }
  const targetManager =
    SDK.targetManager || (SDK.TargetManager.TargetManager || SDK.TargetManager).instance();
  if (targetManager.mainTarget() === null) {
    if (targetManager?.observeTargets) {
      await new Promise(resolve => targetManager.observeTargets({
        targetAdded: resolve,
        targetRemoved: () => {},
      }));
    } else {
      while (targetManager.mainTarget() === null) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  button.click();
})()
`;

/**
 * @param {string} url
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {LH.Puppeteer.Page} page
 * @param {LH.Puppeteer.Browser} browser
 * @param {string} url
 * @param {LH.Config.Json=} config
 * @return {Promise<{lhr: LH.Result, artifacts: LH.Artifacts}>}
 */
async function testPage(page, browser, url, config) {
  const targets = await browser.targets();
  const inspectorTarget = targets.filter(t => t.url().includes('devtools'))[1];
  if (!inspectorTarget) throw new Error('No inspector found.');

  const session = await inspectorTarget.createCDPSession();
  await session.send('Runtime.enable');

  // Navigate to page and wait for initial HTML to be parsed before trying to start LH.
  await new Promise((resolve, reject) => {
    page.target().createCDPSession()
      .then(session => {
        session.send('Page.enable').then(() => {
          session.once('Page.domContentEventFired', resolve);
          page.goto(url);
        });
      })
      .catch(reject);
  });

  if (config) {
    // Must attach to the Lighthouse worker target and override the `self.createConfig`
    // function, allowing us to use any config we want.
    session.send('Target.setAutoAttach', {
      autoAttach: true, flatten: true, waitForDebuggerOnStart: false,
    });
    session.once('Target.attachedToTarget', async (event) => {
      if (event.targetInfo.type !== 'worker') throw new Error('expected lighthouse worker');

      const targets = await browser.targets();
      const workerTarget = targets.find(t => t._targetId === event.targetInfo.targetId);
      if (!workerTarget) throw new Error('No lighthouse worker target found.');

      const workerSession = await workerTarget.createCDPSession();
      await Promise.all([
        workerSession.send('Runtime.enable'),
        workerSession.send('Debugger.enable'),
        new Promise(resolve => {
          workerSession.once('Debugger.scriptParsed', resolve);
        }),
      ]);
      await workerSession.send('Debugger.pause');
      await workerSession.send('Runtime.evaluate', {
        expression: `self.createConfig = () => (${JSON.stringify(config)});`,
      });
      await workerSession.send('Debugger.resume');
    });
  }

  /** @type {Omit<LH.Puppeteer.Protocol.Runtime.EvaluateResponse, 'result'>|undefined} */
  let startLHResponse;
  while (!startLHResponse || startLHResponse.exceptionDetails) {
    if (startLHResponse) await new Promise(resolve => setTimeout(resolve, 1000));
    startLHResponse = await session.send('Runtime.evaluate', {
      expression: startLighthouse,
      awaitPromise: true,
    }).catch(err => ({exceptionDetails: err}));
  }

  /** @type {LH.Puppeteer.Protocol.Runtime.EvaluateResponse} */
  const lhStartedResponse = await session.send('Runtime.evaluate', {
    expression: sniffLighthouseStarted,
    awaitPromise: true,
    returnByValue: true,
  }).catch(err => err);
  // Verify the first parameter to `startLighthouse`, which should be a url.
  // In M100 the LHR is returned on `collectLighthouseResults` which has just 1 options parameter containing `inspectedUrl`.
  // Don't try to check the exact value (because of redirects and such), just
  // make sure it exists.
  if (
    !isValidUrl(lhStartedResponse.result.value) &&
    !isValidUrl(lhStartedResponse.result.value.inspectedURL)
  ) {
    throw new Error(`Lighthouse did not start correctly. Got unexpected value for url: ${
      JSON.stringify(lhStartedResponse.result.value)}`);
  }

  /** @type {LH.Puppeteer.Protocol.Runtime.EvaluateResponse} */
  const remoteLhrResponse = await session.send('Runtime.evaluate', {
    expression: sniffLhr,
    awaitPromise: true,
    returnByValue: true,
  }).catch(err => err);

  if (!remoteLhrResponse.result?.value?.lhr) {
    throw new Error('Problem sniffing LHR.');
  }
  if (!remoteLhrResponse.result?.value?.artifacts) {
    throw new Error('Problem sniffing artifacts.');
  }

  return remoteLhrResponse.result.value;
}

/**
 * @return {Promise<string[]>}
 */
async function readUrlList() {
  if (argv._[0]) return [argv._[0]];

  /** @type {string[]} */
  const urlList = [];
  const rl = readline.createInterface(process.stdin, process.stdout);

  rl.on('line', async line => {
    if (line.startsWith('#')) return;
    urlList.push(line);
  });

  return new Promise(resolve => rl.on('close', () => resolve(urlList)));
}

async function run() {
  const chromeFlags = parseChromeFlags(argv['chromeFlags']);
  const outputDir = argv['output-dir'];

  // Create output directory.
  if (fs.existsSync(outputDir)) {
    if (fs.readdirSync(outputDir).length) {
      // eslint-disable-next-line no-console
      console.warn('WARNING: Output directory is not empty.');
    }
  } else {
    fs.mkdirSync(outputDir);
  }

  const customDevtools = chromeFlags
    .find(f => f.startsWith('--custom-devtools-frontend='))
    ?.replace('--custom-devtools-frontend=', '');
  if (customDevtools) {
    console.log(`Using custom devtools frontend: ${customDevtools}`);
    console.log('Make sure it has been built recently!');
    if (!customDevtools.startsWith('file://')) {
      throw new Error('custom-devtools-frontend must be a file:// URL');
    }
    if (!fs.existsSync(fileURLToPath(customDevtools))) {
      throw new Error('custom-devtools-frontend does not exist');
    }
  }

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: chromeFlags,
    devtools: true,
  });

  if ((await browser.version()).startsWith('Headless')) {
    throw new Error('You cannot use headless');
  }

  let errorCount = 0;
  const urlList = await readUrlList();
  for (let i = 0; i < urlList.length; ++i) {
    const page = await browser.newPage();
    try {
      /** @type {NodeJS.Timeout} */
      let timeout;
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(reject, 100_000, new Error('Timed out waiting for Lighthouse to run'));
      });
      const {lhr, artifacts} = await Promise.race([
        testPage(page, browser, urlList[i], config),
        timeoutPromise,
      ]).finally(() => {
        clearTimeout(timeout);
      });

      fs.writeFileSync(`${argv.o}/lhr-${i}.json`, JSON.stringify(lhr, null, 2));
      fs.writeFileSync(`${argv.o}/artifacts-${i}.json`, JSON.stringify(artifacts, null, 2));
    } catch (error) {
      errorCount += 1;
      console.error(error.message);
      fs.writeFileSync(`${argv.o}/lhr-${i}.json`, JSON.stringify({error: error.message}, null, 2));
    } finally {
      try {
        await page.close();
      } catch {}
    }
  }
  console.log(`${urlList.length - errorCount} / ${urlList.length} urls run successfully.`);
  console.log(`Results saved to ${argv.o}`);

  await browser.close();

  if (errorCount) process.exit(1);
}
run();
