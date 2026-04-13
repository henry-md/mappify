function normalizeBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isDebugUiEnabled() {
  return normalizeBoolean(process.env.DEBUG_UI);
}
