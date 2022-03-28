/**
 * @license Copyright 2016 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const puppeteer = require('puppeteer-core');
const Runner = require('./runner.js');
const log = require('lighthouse-logger');
const ChromeProtocol = require('./gather/connections/cri.js');
const Config = require('./config/config.js');
const URL = require('./lib/url-shim.js');
const fraggleRock = require('./fraggle-rock/api.js');

/** @typedef {import('./gather/connections/connection.js')} Connection */

const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 9222;

/*
 * The relationship between these root modules:
 *
 *   index.js  - the require('lighthouse') hook for Node modules (including the CLI)
 *
 *   runner.js - marshalls the actions that must be taken (Gather / Audit)
 *               config file is used to determine which of these actions are needed
 *
 *         lighthouse-cli \
 *                         -- core/index.js ----> runner.js ----> [Gather / Audit]
 *                clients /
 */

/**
 * Run Lighthouse.
 * @param {string=} url The URL to test. Optional if running in auditMode.
 * @param {LH.Flags=} flags Optional settings for the Lighthouse run. If present,
 *   they will override any settings in the config.
 * @param {LH.Config.Json=} configJSON Configuration for the Lighthouse run. If
 *   not present, the default config is used.
 * @param {LH.Puppeteer.Page=} page
 * @return {Promise<LH.RunnerResult|undefined>}
 */
async function lighthouse(url, flags = {}, configJSON, page) {
  if (!page) {
    const {hostname = DEFAULT_HOSTNAME, port = DEFAULT_PORT} = flags;
    const browser = await puppeteer.connect({browserURL: `http://${hostname}:${port}`});
    page = await browser.newPage();
  }
  const configContext = {
    configPath: flags.configPath,
    settingsOverrides: flags,
    logLevel: flags.logLevel,
  };
  return fraggleRock.navigation(url, {page, config: configJSON, configContext});
}

/**
 * Run Lighthouse using the legacy navigation runner.
 * This is left in place for any clients that don't support FR navigations yet (e.g. Lightrider)
 * @param {string=} url The URL to test. Optional if running in auditMode.
 * @param {LH.Flags=} flags Optional settings for the Lighthouse run. If present,
 *   they will override any settings in the config.
 * @param {LH.Config.Json=} configJSON Configuration for the Lighthouse run. If
 *   not present, the default config is used.
 * @param {Connection=} userConnection
 * @return {Promise<LH.RunnerResult|undefined>}
 */
async function legacyNavigation(url, flags = {}, configJSON, userConnection) {
  // set logging preferences, assume quiet
  flags.logLevel = flags.logLevel || 'error';
  log.setLevel(flags.logLevel);

  const config = generateConfig(configJSON, flags);
  const computedCache = new Map();
  const options = {config, computedCache};
  const connection = userConnection || new ChromeProtocol(flags.port, flags.hostname);

  // kick off a lighthouse run
  const artifacts = await Runner.gather(() => {
    const requestedUrl = URL.normalizeUrl(url);
    return Runner._gatherArtifactsFromBrowser(requestedUrl, options, connection);
  }, options);
  return Runner.audit(artifacts, options);
}

/**
 * Generate a Lighthouse Config.
 * @param {LH.Config.Json=} configJson Configuration for the Lighthouse run. If
 *   not present, the default config is used.
 * @param {LH.Flags=} flags Optional settings for the Lighthouse run. If present,
 *   they will override any settings in the config.
 * @return {Config}
 */
function generateConfig(configJson, flags) {
  return new Config(configJson, flags);
}

lighthouse.legacyNavigation = legacyNavigation;
lighthouse.generateConfig = generateConfig;
lighthouse.getAuditList = Runner.getAuditList;
lighthouse.traceCategories = require('./gather/driver.js').traceCategories;
lighthouse.Audit = require('./audits/audit.js');
lighthouse.Gatherer = require('./gather/gatherers/gatherer.js');

// Explicit type reference (hidden by makeComputedArtifact) for d.ts export.
// TODO(esmodules): should be a workaround for module.export and can be removed when in esm.
/** @type {typeof import('./computed/network-records.js')} */
lighthouse.NetworkRecords = require('./computed/network-records.js');

module.exports = lighthouse;
