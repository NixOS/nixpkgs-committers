#!/usr/bin/env node
// Local runner for scripts/retire.js, providing an Octokit shim
// backed by the `gh` CLI so no npm dependencies are needed.
// See scripts/README.md for the test sequence.

'use strict';

const { execFileSync } = require('child_process');
const retire = require('./retire.js');

function usage() {
  console.error(`Usage: ${process.argv[1]} ORG ACTIVITY_REPO MEMBER_REPO DIR NOTICE_CUTOFF CLOSE_CUTOFF CONFIRM_CUTOFF`);
  console.error('');
  console.error('Optionally set CACHE_FILE to a path for persisting activity observations between runs.');
  console.error('Set PROD=1 to actually perform side effects.');
  process.exit(1);
}

const [org, activityRepo, memberRepo, dir, noticeCutoffSpec, closeCutoffSpec, confirmCutoffSpec] =
  process.argv.slice(2);
if (!confirmCutoffSpec) {
  usage();
}

function gh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const github = {
  async request(route, params = {}) {
    const [method, pathTemplate] = route.split(' ');
    let args;
    let input;
    if (method === 'GET') {
      const query = new URLSearchParams(params).toString();
      args = ['api', '-X', 'GET', query ? `${pathTemplate}?${query}` : pathTemplate];
    } else {
      args = ['api', '-X', method, pathTemplate, '--input', '-'];
      input = JSON.stringify(params);
    }
    const out = gh(args, input);
    return { data: out.trim() === '' ? null : JSON.parse(out) };
  },
  async graphql(query, variables = {}) {
    const out = gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
    const parsed = JSON.parse(out);
    if (parsed.errors) {
      throw new Error(JSON.stringify(parsed.errors));
    }
    return parsed.data;
  },
};

retire({
  github,
  options: {
    org,
    activityRepo,
    memberRepo,
    dir,
    noticeCutoffSpec,
    closeCutoffSpec,
    confirmCutoffSpec,
    cacheFile: process.env.CACHE_FILE,
    prod: Boolean(process.env.PROD),
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
