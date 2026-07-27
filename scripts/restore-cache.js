// Restores the activity cache artifact uploaded by the previous successful
// run of the retire workflow on the given branch, for use by scripts/retire.js.
// Runs on other branches (e.g. manual test runs) are ignored.
// Runs in CI via actions/github-script (see .github/workflows/retire.yml).
//
// Any failure here only means starting without a cache, which is safe:
// a missing cache can delay retirements, but never cause one.

'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function restoreCache({ github, context, core, artifactName, dir, branch }) {
  const { owner, repo } = context.repo;
  try {
    const runs = (
      await github.request(`GET /repos/${owner}/${repo}/actions/workflows/retire.yml/runs`, {
        status: 'success',
        branch,
        per_page: 1,
      })
    ).data.workflow_runs;
    if (runs.length === 0) {
      core.info(`No previous successful run on ${branch}, starting fresh`);
      return;
    }
    const runId = runs[0].id;

    const artifacts = (
      await github.request(`GET /repos/${owner}/${repo}/actions/runs/${runId}/artifacts`)
    ).data.artifacts;
    const artifact = artifacts.find((a) => a.name === artifactName && !a.expired);
    if (!artifact) {
      core.warning(`Run ${runId} has no ${artifactName} artifact, starting fresh`);
      return;
    }

    // Despite the endpoint's name, an artifact uploaded with `archive: false`
    // downloads as the file itself. A .json file is served as application/json,
    // which Octokit parses, but accept raw text or bytes as well.
    const { data } = await github.request(
      `GET /repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
    );
    const contents =
      data instanceof ArrayBuffer
        ? Buffer.from(data)
        : typeof data === 'string'
          ? data
          : JSON.stringify(data);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, artifactName), contents);
    core.info(`Restored activity cache from run ${runId}`);
  } catch (err) {
    core.warning(`Could not restore activity cache, starting fresh: ${err.message}`);
  }
};
