/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const NoUnloadListeners = require('../../audits/no-unload-listeners.js');
const {createScript} = require('../test-utils.js');

/* eslint-env jest */

const testScripts = [
  {scriptId: '12', url: 'https://example.com/1.js'},
  {scriptId: '13', url: 'https://example.com/1.js'},
  {scriptId: '16', url: 'https://example.com/1.js'},
  {scriptId: '17', url: 'https://example.com/1.js'},
  {scriptId: '22', url: 'https://example.com/2.js'},
  {scriptId: '23', url: 'https://example.com/2.js'},
  {scriptId: '26', url: 'https://example.com/2.js'},
  {scriptId: '27', url: 'https://example.com/2.js'},
].map(createScript);

describe('No Unload Listeners', () => {
  it('passes when there were no listeners', async () => {
    const artifacts = {
      GlobalListeners: [],
      SourceMaps: [],
      Scripts: testScripts,
    };
    const context = {computedCache: new Map()};
    const result = await NoUnloadListeners.audit(artifacts, context);
    expect(result).toEqual({score: 1});
  });

  it('passes when there were no `unload` listeners', async () => {
    const GlobalListeners = [{
      type: 'DOMContentLoaded', scriptId: '12', lineNumber: 5, columnNumber: 0,
    }];
    const artifacts = {
      GlobalListeners,
      SourceMaps: [],
      Scripts: testScripts,
    };
    const context = {computedCache: new Map()};
    const result = await NoUnloadListeners.audit(artifacts, context);
    expect(result).toEqual({score: 1});
  });

  it('fails when there are unload listeners and matches them to script locations', async () => {
    const GlobalListeners = [
      {type: 'unload', scriptId: '16', lineNumber: 10, columnNumber: 30},
      {type: 'unload', scriptId: '23', lineNumber: 0, columnNumber: 0},
    ];
    const artifacts = {
      GlobalListeners,
      SourceMaps: [],
      Scripts: testScripts,
    };
    const context = {computedCache: new Map()};
    const result = await NoUnloadListeners.audit(artifacts, context);
    expect(result.score).toEqual(0);
    expect(result.details.items).toMatchObject([
      {
        source: {type: 'source-location', url: 'https://example.com/1.js', urlProvider: 'network', line: 10, column: 30},
      }, {
        source: {type: 'source-location', url: 'https://example.com/2.js', urlProvider: 'network', line: 0, column: 0},
      },
    ]);
  });

  // eslint-disable-next-line max-len
  it('fails when there are unload listeners and has a fallback if script URL is not found', async () => {
    const GlobalListeners = [
      {type: 'DOMContentLoaded', scriptId: '12', lineNumber: 5, columnNumber: 0},
      {type: 'unload', scriptId: 'notascriptid', lineNumber: 10, columnNumber: 30},
      {type: 'unload', scriptId: '22', lineNumber: 1, columnNumber: 100},
    ];
    const artifacts = {
      GlobalListeners,
      SourceMaps: [],
      Scripts: testScripts,
    };
    const context = {computedCache: new Map()};
    const result = await NoUnloadListeners.audit(artifacts, context);
    expect(result.score).toEqual(0);
    expect(result.details.items).toMatchObject([
      {
        source: {type: 'url', value: '(unknown):10:30'},
      }, {
        source: {type: 'source-location', url: 'https://example.com/2.js', urlProvider: 'network', line: 1, column: 100},
      },
    ]);
  });
});
