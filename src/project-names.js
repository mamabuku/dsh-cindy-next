/**
 * Project display names shared by the session projection and the alias channel.
 *
 * The default Workspace is stored as `default-workspace`, but DSH's own sidebar
 * renders it as 「默认工作区」; the phone must read the same thing the user sees,
 * not the storage key.
 */
export const PROJECT_DISPLAY_PREFIX = '/__dsh_project__';
export const UNFILED_PROJECT_PATH = '/未分组';

const DISPLAY_TITLE_OVERRIDES = new Map([['default-workspace', '默认工作区']]);

/** The human name for a Workspace title, with DSH's own localisations applied. */
export function displayProjectName(value) {
  if (typeof value !== 'string') return '';
  const title = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (title === '') return '';
  return DISPLAY_TITLE_OVERRIDES.get(title) ?? title;
}
