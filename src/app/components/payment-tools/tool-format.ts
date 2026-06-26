const sensitiveToolField =
  /authorization|cookie|secret|token|email|user.?id|payment-signature|x-payment/i;

function redactToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactToolValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveToolField.test(key) ? "[redacted]" : redactToolValue(item),
      ]),
    );
  }

  return value;
}

export function formatToolValue(value: unknown) {
  if (value === undefined) return null;

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value.length > 12000 ? `${value.slice(0, 12000)}\n...` : value;
    }
  }

  const formatted = JSON.stringify(redactToolValue(parsed), null, 2);
  return formatted.length > 12000
    ? `${formatted.slice(0, 12000)}\n...`
    : formatted;
}
