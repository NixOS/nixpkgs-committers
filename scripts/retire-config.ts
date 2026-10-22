// Date specs use the UTC syntax supported by parseDate in retire.ts.
// Relative specs are evaluated against the same instant for each run.
export default {
  // How long a retirement PR stays a draft before it is ready to merge.
  noticeCutoffSpec: 'yesterday 1 month ago',

  // Skip users whose retirement PR was closed more recently than this.
  closeCutoffSpec: '1 year ago',

  // Require repeated inactivity observations over this period before opening a PR.
  confirmCutoffSpec: '7 days ago',

  // Skip people who received their commit bit more recently than this.
  newCutoffSpec: '1 year ago',

  // People are active if they merged a PR more recently than this.
  activityCutoffSpec: '1 year ago',

  // Trust cached merges newer than this without querying GitHub again.
  // The gap until the activity cutoff gives about a month of daily queries
  // agreeing before a retirement PR can be opened (see issue #100).
  queryCutoffSpec: '11 months ago',

  // Before this date, member file creation dates may not match when people
  // received their commit bit. Use file contents for those members instead:
  //
  // | commit bit reception date  | file creation date | file contents  |
  // | -------------------------- | ------------------ | -------------- |
  // | A)         -∞ - 2024-10-06 | 2025-07-16         | empty          |
  // | B) 2024-10-07 - 2025-04-22 | 2025-07-16         | reception date |
  // | C) 2025-08-13 - ∞          | reception date     | empty          |
  //
  // After 2026-04-23, the file creation date for all first-year committers
  // matches the reception date, so this special handling can be removed.
  createdOnReceptionSpec: '2025-07-17',
};
