const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/;
const STAGING_WORD = /(^|[^a-z])(staging|stage|uat|test|dev|qa|demo|sandbox|preview)([^a-z]|$)/;

/**
 * Guess which environment an Odoo database runs in, from its name and host.
 *
 * @param {string} db - Database name, e.g. "kaw_staging".
 * @param {string} host - Page hostname, e.g. "erp.example.com".
 * @returns {"local"|"staging"|"prod"}
 */
export function detectEnv(db, host) {
  if (LOCAL_HOST.test(host)) return "local";
  if (STAGING_WORD.test(`${db} ${host}`.toLowerCase())) return "staging";
  return "prod";
}
