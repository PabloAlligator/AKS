function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    return url.origin;
  } catch {
    return '';
  }
}

function buildAllowedOrigins() {
  const port = Number(process.env.PORT) || 3000;

  const origins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  const configuredValues = [
    process.env.APP_ORIGIN,
    process.env.SITE_URL,
  ];

  configuredValues
    .flatMap((value) => String(value || '').split(','))
    .map((value) => normalizeOrigin(value))
    .filter(Boolean)
    .forEach((origin) => {
      origins.add(origin);
    });

  return origins;
}

const allowedOrigins = buildAllowedOrigins();

function validateOrigin(req, res, next) {
  const origin = normalizeOrigin(
    req.get('origin'),
  );

  if (!origin || !allowedOrigins.has(origin)) {
    return res.status(403).json({
      message: 'Недопустимый источник запроса',
    });
  }

  return next();
}

export default validateOrigin;
