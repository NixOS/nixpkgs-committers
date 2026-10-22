// Date specs use the UTC syntax supported by parseDate in retire.ts.
// Relative specs are evaluated against the same instant for each run.
export default {
  // How long a retirement PR stays a draft before it is ready to merge.
  noticeCutoffSpec: 'yesterday 1 month ago',

  // Skip users whose retirement PR was closed more recently than this.
  closeCutoffSpec: '6 months ago',

  // Require repeated inactivity observations over this period before opening a PR.
  confirmCutoffSpec: '7 days ago',

  // Skip people who received their commit bit more recently than this.
  newCutoffSpec: '6 months ago',

  // People are active if they merged a PR more recently than this.
  activityCutoffSpec: '6 months ago',

  // Trust cached merges newer than this without querying GitHub again.
  // The gap until the activity cutoff gives about a month of daily queries
  // agreeing before a retirement PR can be opened (see issue #100).
  queryCutoffSpec: '5 months ago',
};
