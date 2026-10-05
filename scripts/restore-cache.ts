// Restores the activity cache artifact uploaded by the previous successful
// run of the retire workflow on the given branch, for use by scripts/retire.ts.
// Runs on other branches (e.g. manual test runs) are ignored.
// Runs in CI via actions/github-script (see .github/workflows/retire.yml).
//
// Any failure here only means starting without a cache, which is safe:
// a missing cache can delay retirements, but never cause one.

import fs from 'node:fs';
import path from 'node:path';

type GitHub = InstanceType<typeof import('@actions/github/lib/utils').GitHub>
type Context = typeof import('@actions/github').context
type Core = typeof import('@actions/core')

export default async function restoreCache({ github, context, core, artifactName, dir, branch }: {
  github: GitHub
  context: Context
  core: Core
  artifactName: string
  dir: string
  branch: string
}): Promise<void> {
  const { owner, repo } = context.repo;
  try {
    const runs = (
      await github.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: 'retire.yml',
        status: 'success',
        branch,
        per_page: 1,
      })
    ).data.workflow_runs;
    if (runs.length === 0) {
      core.info(`No previous successful run on ${branch}, starting fresh`);
      return;
    }
    const run_id = runs[0].id;

    const artifacts = (
      await github.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id,
      })
    ).data.artifacts;
    const artifact = artifacts.find((a) => a.name === artifactName && !a.expired);
    if (!artifact) {
      core.warning(`Run ${run_id} has no ${artifactName} artifact, starting fresh`);
      return;
    }

    // Despite the endpoint's name, an artifact uploaded with `archive: false`
    // downloads as the file itself. A .json file is served as application/json,
    // which Octokit parses, but accept raw text or bytes as well.
    const { data } = await github.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifact.id,
        archive_format: 'zip',
    })
    const contents =
      data instanceof ArrayBuffer
        ? Buffer.from(data)
        : typeof data === 'string'
          ? data
          : JSON.stringify(data);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, artifactName), contents);
    core.info(`Restored activity cache from run ${run_id}`);
  } catch (err) {
    core.warning(`Could not restore activity cache, starting fresh: ${err instanceof Error ? err.message : String(err)}`);
  }
}
