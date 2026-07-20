const IS_PRODUCTION =
  process.env.NODE_ENV === 'production';

export const SESSION_COOKIE_NAME =
  'autocat_admin_session';

// полная продолжительность сессии — 12 часов

export const SESSION_TTL_MS =
  12 * 60 * 60 * 1000;

// выход после 12 часов отсутствия активности

export const SESSION_IDLE_TIMEOUT_MS =
  12 * 60 * 60 * 1000;

// записываем активность в БД не чаще раза в 5 минут

export const SESSION_TOUCH_INTERVAL_MS =
  5 * 60 * 1000;

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/admin',
    maxAge: SESSION_TTL_MS,
  };
}

export function getSessionCookieClearOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/admin',
  };
}
