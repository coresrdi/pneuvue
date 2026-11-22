/** Garde l'écran allumé pendant une écoute (no-op sur le web si le plugin est absent). */
export async function stayAwake() {
  try {
    const { KeepAwake } = await import("@capacitor-community/keep-awake");
    await KeepAwake.keepAwake();
  } catch {
    /* web, ou plugin indisponible */
  }
}

export async function allowSleep() {
  try {
    const { KeepAwake } = await import("@capacitor-community/keep-awake");
    await KeepAwake.allowSleep();
  } catch {
    /* ignore */
  }
}
