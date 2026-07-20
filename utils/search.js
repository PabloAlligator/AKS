export function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLeadSearchText({
  name,
  phone,
  service,
  message,
  source,
  internalComment,
}) {
  return normalizeSearchText(
    [
      name,
      phone,
      service,
      message,
      source,
      internalComment,
    ]
      .filter(Boolean)
      .join(' '),
  );
}
