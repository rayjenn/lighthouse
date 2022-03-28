/**
 * @license Copyright 2018 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * @fileoverview Script to bundle lighthouse entry points so that they can be run
 * in the browser (as long as they have access to a debugger protocol Connection).
 */

const fs = require('fs');
const path = require('path');
const rollup = require('rollup');
const rollupPlugins = require('./rollup-plugins.js');
const Runner = require('../lighthouse-core/runner.js');
const {LH_ROOT} = require('../root.js');

const COMMIT_HASH = require('child_process')
  .execSync('git rev-parse HEAD')
  .toString().trim();

// HACK: manually include the lighthouse-plugin-publisher-ads audits.
/** @type {Array<string>} */
// @ts-expect-error
const pubAdsAudits = require('lighthouse-plugin-publisher-ads/plugin.js').audits.map(a => a.path);

/** @param {string} file */
const isDevtools = file =>
  path.basename(file).includes('devtools') || path.basename(file).endsWith('dt-bundle.js');
/** @param {string} file */
const isLightrider = file => path.basename(file).includes('lightrider');

// Set to true for source maps.
const DEBUG = false;

const today = (() => {
  const date = new Date();
  const year = new Intl.DateTimeFormat('en', {year: 'numeric'}).format(date);
  const month = new Intl.DateTimeFormat('en', {month: 'short'}).format(date);
  const day = new Intl.DateTimeFormat('en', {day: '2-digit'}).format(date);
  return `${month} ${day} ${year}`;
})();
const pkg = JSON.parse(fs.readFileSync(LH_ROOT + '/package.json', 'utf-8'));
const banner = `
/**
 * Lighthouse v${pkg.version} ${COMMIT_HASH} (${today})
 *
 * ${pkg.description}
 *
 * @homepage ${pkg.homepage}
 * @author   ${pkg.author}
 * @license  ${pkg.license}
 */
`.trim();

/**
 * Bundle starting at entryPath, writing the minified result to distPath.
 * @param {string} entryPath
 * @param {string} distPath
 * @param {{minify: boolean}=} opts
 * @return {Promise<void>}
 */
async function build(entryPath, distPath, opts = {minify: true}) {
  if (fs.existsSync(LH_ROOT + '/lighthouse-logger/node_modules')) {
    throw new Error('delete `lighthouse-logger/node_modules` because it messes up rollup bundle');
  }

  // List of paths (absolute / relative to config-helpers.js) to include
  // in bundle and make accessible via config-helpers.js `requireWrapper`.
  const dynamicModulePaths = [
    ...Runner.getGathererList().map(gatherer => `../gather/gatherers/${gatherer}`),
    ...Runner.getAuditList().map(gatherer => `../audits/${gatherer}`),
  ];

  // Include lighthouse-plugin-publisher-ads.
  if (isDevtools(entryPath) || isLightrider(entryPath)) {
    dynamicModulePaths.push('lighthouse-plugin-publisher-ads');
    pubAdsAudits.forEach(pubAdAudit => {
      dynamicModulePaths.push(pubAdAudit);
    });
  }

  const bundledMapEntriesCode = dynamicModulePaths.map(modulePath => {
    const pathNoExt = modulePath.replace('.js', '');
    return `['${pathNoExt}', require('${modulePath}')]`;
  }).join(',\n');

  /** @type {Record<string, string>} */
  const shimsObj = {};

  const modulesToIgnore = [
    'puppeteer-core',
    'intl-pluralrules',
    'intl',
    'pako/lib/zlib/inflate.js',
    '@sentry/node',
    'source-map',
    'ws',
    require.resolve('../lighthouse-core/gather/connections/cri.js'),
  ];

  // Don't include the stringified report in DevTools - see devtools-report-assets.js
  // Don't include in Lightrider - HTML generation isn't supported, so report assets aren't needed.
  if (isDevtools(entryPath) || isLightrider(entryPath)) {
    modulesToIgnore.push(require.resolve('../report/generator/report-assets.js'));
  }

  // Don't include locales in DevTools.
  if (isDevtools(entryPath)) {
    shimsObj['./locales.js'] = 'export default {}';
  }

  for (const modulePath of modulesToIgnore) {
    shimsObj[modulePath] = 'export default {}';
  }

  shimsObj[require.resolve('../package.json')] =
    `export const version = ${JSON.stringify(require('../package.json').version)}`;

  const bundle = await rollup.rollup({
    input: entryPath,
    context: 'globalThis',
    plugins: [
      rollupPlugins.replace({
        delimiters: ['', ''],
        values: {
          '/* BUILD_REPLACE_BUNDLED_MODULES */': `[\n${bundledMapEntriesCode},\n]`,
          '__dirname': (id) => `'${path.relative(LH_ROOT, path.dirname(id))}'`,
          '__filename': (id) => `'${path.relative(LH_ROOT, id)}'`,
          // This package exports to default in a way that causes Rollup to get confused,
          // resulting in MessageFormat being undefined.
          'require(\'intl-messageformat\').default': 'require(\'intl-messageformat\')',
          // Below we replace lighthouse-logger with a local copy, which is ES modules. Need
          // to change every require of the package to reflect this.
          'require(\'lighthouse-logger\');': 'require(\'lighthouse-logger\').default;',
          // Rollup doesn't replace this, so let's manually change it to false.
          'require.main === module': 'false',
          // TODO: Use globalThis directly.
          'global.isLightrider': 'globalThis.isLightrider',
          'global.isDevtools': 'globalThis.isDevtools',
        },
      }),
      rollupPlugins.alias({
        entries: {
          'debug': require.resolve('debug/src/browser.js'),
          'lighthouse-logger': require.resolve('../lighthouse-logger/index.js'),
        },
      }),
      rollupPlugins.shim({
        ...shimsObj,
        // Allows for plugins to import lighthouse.
        'lighthouse': `
          import Audit from '${require.resolve('../lighthouse-core/audits/audit.js')}';
          export {Audit};
        `,
        // Most node 'url' polyfills don't include the WHATWG `URL` property, but
        // that's all that's needed, so make a mini-polyfill.
        // @see https://github.com/GoogleChrome/lighthouse/issues/5273
        // TODO: remove when not needed for pubads (https://github.com/googleads/publisher-ads-lighthouse-plugin/pull/325)
        'url': 'export const URL = globalThis.URL;',
      }),
      rollupPlugins.json(),
      rollupPlugins.inlineFs({verbose: false}),
      rollupPlugins.commonjs({
        // https://github.com/rollup/plugins/issues/922
        ignoreGlobal: true,
      }),
      rollupPlugins.nodePolyfills(),
      rollupPlugins.nodeResolve({preferBuiltins: true}),
      // Rollup sees the usages of these functions in page functions (ex: see AnchorElements)
      // and treats them as globals. Because the names are "taken" by the global, Rollup renames
      // the actual functions (getNodeDetails$1). The page functions expect a certain name, so
      // here we undo what Rollup did.
      rollupPlugins.postprocess([
        [/getBoundingClientRect\$1/, 'getBoundingClientRect'],
        [/getElementsInDocument\$1/, 'getElementsInDocument'],
        [/getNodeDetails\$1/, 'getNodeDetails'],
        [/getRectCenterPoint\$1/, 'getRectCenterPoint'],
        [/isPositionFixed\$1/, 'isPositionFixed'],
      ]),
      opts.minify && rollupPlugins.terser({
        ecma: 2019,
        output: {
          comments: (node, comment) => {
            const text = comment.value;
            if (text.includes('The Lighthouse Authors') && comment.line > 1) return false;
            return /@ts-nocheck - Prevent tsc|@preserve|@license|@cc_on|^!/i.test(text);
          },
          max_line_len: 1000,
        },
        // The config relies on class names for gatherers.
        keep_classnames: true,
        // Runtime.evaluate errors if function names are elided.
        keep_fnames: true,
      }),
    ],
  });

  await bundle.write({
    file: distPath,
    banner,
    format: 'iife',
    sourcemap: DEBUG,
  });
  await bundle.close();
}

/**
 * @param {Array<string>} argv
 */
async function cli(argv) {
  // Take paths relative to cwd and build.
  const [entryPath, distPath] = argv.slice(2)
    .map(filePath => path.resolve(process.cwd(), filePath));
  await build(entryPath, distPath);
}

// Test if called from the CLI or as a module.
if (require.main === module) {
  cli(process.argv).catch(err => {
    console.error(err);
    process.exit(1);
  });
} else {
  module.exports = {
    /** The commit hash for the current HEAD. */
    COMMIT_HASH,
    build,
  };
}
