/**
 * @license Copyright 2022 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const FRGatherer = require('../../fraggle-rock/gather/base-gatherer.js');

/**
 * @template T, U
 * @param {Array<T>} values
 * @param {(value: T) => Promise<U>} promiseMapper
 * @param {boolean} runInSeries
 * @return {Promise<Array<U>>}
 */
async function runInSeriesOrParallel(values, promiseMapper, runInSeries) {
  if (runInSeries) {
    const results = [];
    for (const value of values) {
      const result = await promiseMapper(value);
      results.push(result);
    }
    return results;
  } else {
    const promises = values.map(promiseMapper);
    return await Promise.all(promises);
  }
}

/**
 * @fileoverview Gets JavaScript file contents.
 */
class Scripts extends FRGatherer {
  /** @type {LH.Gatherer.GathererMeta} */
  meta = {
    supportedModes: ['timespan', 'navigation'],
  };

  /** @type {LH.Crdp.Debugger.ScriptParsedEvent[]} */
  _scriptParsedEvents = [];

  /** @type {Array<string | undefined>} */
  _scriptContents = [];

  /** @type {string|null|undefined} */
  _mainSessionId = null;

  constructor() {
    super();
    this.onProtocolMessage = this.onProtocolMessage.bind(this);
  }

  /**
   * @param {LH.Protocol.RawEventMessage} event
   */
  onProtocolMessage(event) {
    // Go read the comments in network-recorder.js _findRealRequestAndSetSession.
    let sessionId = event.sessionId;
    if (this._mainSessionId === null) {
      this._mainSessionId = sessionId;
    }
    if (this._mainSessionId === sessionId) {
      sessionId = undefined;
    }

    // We want to ignore scripts from OOPIFs. In reality, this does more than block just OOPIFs,
    // it also blocks scripts from the same origin but that happen to run in a different process,
    // like a worker.
    if (event.method === 'Debugger.scriptParsed' && !sessionId) {
      // Events without an embedderName (read: a url) are for JS that we ran over the protocol.
      if (event.params.embedderName) this._scriptParsedEvents.push(event.params);
    }
  }

  /**
   * @param {LH.Gatherer.FRTransitionalContext} context
   */
  async startInstrumentation(context) {
    const session = context.driver.defaultSession;
    session.addProtocolMessageListener(this.onProtocolMessage);
    await session.sendCommand('Debugger.enable');
  }

  /**
   * @param {LH.Gatherer.FRTransitionalContext} context
   */
  async stopInstrumentation(context) {
    const session = context.driver.defaultSession;
    const formFactor = context.baseArtifacts.HostFormFactor;

    session.removeProtocolMessageListener(this.onProtocolMessage);

    // Without this line the Debugger domain will be off in FR runner,
    // because only the legacy gatherer has special handling for multiple,
    // overlapped enabled/disable calls.
    await session.sendCommand('Debugger.enable');

    // If run on a mobile device, be sensitive to memory limitations and only
    // request one at a time.
    this._scriptContents = await runInSeriesOrParallel(
      this._scriptParsedEvents,
      ({scriptId}) => {
        return session.sendCommand('Debugger.getScriptSource', {scriptId})
          .then((resp) => resp.scriptSource)
          .catch(() => undefined);
      },
      formFactor === 'mobile' /* runInSeries */
    );
    await session.sendCommand('Debugger.disable');
  }

  async getArtifact() {
    /** @type {LH.Artifacts['Scripts']} */
    const scripts = this._scriptParsedEvents.map((event, i) => {
      // 'embedderName' and 'url' are confusingly named, so we rewrite them here.
      // On the protocol, 'embedderName' always refers to the URL of the script (or HTML if inline).
      // Same for 'url' ... except, magic "sourceURL=" comments will override the value.
      // It's nice to display the user-provided value in Lighthouse, so we add a field 'name'
      // to make it clear this is for presentational purposes.
      // See https://chromium-review.googlesource.com/c/v8/v8/+/2317310
      return {
        name: event.url,
        ...event,
        // embedderName is optional on the protocol because backends like Node may not set it.
        // For our purposes, it is always set. But just in case it isn't... fallback to the url.
        url: event.embedderName || event.url,
        content: this._scriptContents[i],
      };
    });

    return scripts;
  }
}

module.exports = Scripts;
