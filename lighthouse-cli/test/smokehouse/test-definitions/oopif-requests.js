/**
 * @license Copyright 2019 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/** @type {LH.Config.Json} */
const config = {
  extends: 'lighthouse:default',
  categories: {
    performance: {
      title: 'Performance',
      auditRefs: [
        {id: 'oopif-iframe-test-audit', weight: 0},
        {id: 'script-elements-test-audit', weight: 0},
      ],
    },
  },
  audits: [
    // Include an audit that *forces* the IFrameElements artifact to be used for our test.
    {path: 'oopif-iframe-test-audit'},
    {path: 'script-elements-test-audit'},
  ],
  settings: {
    // This test runs in CI and hits the outside network of a live site.
    // Be a little more forgiving on how long it takes all network requests of several nested iframes
    // to complete.
    maxWaitForLoad: 180000,
  },
  passes: [{
    passName: 'defaultPass',
    // CI machines are pretty weak which lead to many more long tasks than normal.
    // Reduce our requirement for CPU quiet.
    cpuQuietThresholdMs: 500,
  }],
};

/**
 * @type {Smokehouse.ExpectedRunnerResult}
 * Expected Lighthouse audit values for sites with OOPIFS.
 */
const expectations = {
  lhr: {
    requestedUrl: 'http://localhost:10200/oopif-requests.html',
    finalUrl: 'http://localhost:10200/oopif-requests.html',
    audits: {
      'network-requests': {
        details: {
          items: {
          // We want to make sure we are finding the iframe's requests (paulirish.com) *AND*
          // the iframe's iframe's iframe's requests (youtube.com/doubleclick/etc).
          // - paulirish.com ~40-60 requests
          // - paulirish.com + all descendant iframes ~80-90 requests
            length: '>70',
          },
        },
      },
    },
  },
  artifacts: {
    IFrameElements: [
      {
        id: 'oopif',
        src: 'https://www.paulirish.com/2012/why-moving-elements-with-translate-is-better-than-posabs-topleft/',
        clientRect: {
          width: '>0',
          height: '>0',
        },
        isPositionFixed: false,
      },
    ],
    ScriptElements: [],
    Scripts: [],
  },
};

export default {
  id: 'oopif-requests',
  expectations,
  config,
};
