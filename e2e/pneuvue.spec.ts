import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const OUT = "/workspace/pneuvue-test";
fs.mkdirSync(OUT, { recursive: true });

function shotName(page: Page, label: string) {
  const vp = page.viewportSize();
  const orient = vp && vp.width < vp.height ? "portrait" : "paysage";
  return path.join(OUT, `${label}-${orient}-${vp?.width}x${vp?.height}.png`);
}

async function collectConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("PneuVue — écran principal", () => {
  test("affiche le Jeep, la roulotte et les pressions simulées", async ({ page }, info) => {
    const errors = await collectConsole(page);
    await page.goto("/");
    await expect(page.getByText("PneuVue")).toBeVisible();
    await expect(page.getByText("Jeep GC & Roulotte")).toBeVisible();
    await expect(page.getByText("Simulation des pressions")).toBeVisible();
    await expect(page.getByText("Roulotte 25 pi attelée, secours Jeep et secours roulotte.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Jeep/i })).toBeVisible();
    await expect(page.getByRole("img", { name: /Roulotte/i })).toBeVisible();
    await expect(page.getByText("AV G")).toBeVisible();
    await expect(page.getByText("G INT")).toBeVisible();
    await expect(page.getByText("Assigner les capteurs")).toBeVisible();
    await expect(page.getByText("10/10")).toBeVisible();
    // Valeurs simulées de base (légère oscillation autour de la référence)
    await expect(page.getByText("Psi").first()).toBeVisible();
    await page.screenshot({ path: shotName(page, "accueil"), fullPage: true });
    const severe = errors.filter((e) => !/favicon|fonts\.google|Failed to load resource/i.test(e));
    expect(severe, severe.join("\n")).toEqual([]);
  });

  test("passe de l'été à l'hiver et masque la roulotte", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Hiver/ }).click();
    await expect(page.getByText("Seulement les 5 pneus du Jeep, secours compris.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Roulotte/i })).toHaveCount(0);
    await expect(page.getByText("G INT")).toHaveCount(0);
    await expect(page.getByText("5/5")).toBeVisible();
    await page.screenshot({ path: shotName(page, "hiver"), fullPage: true });
    await page.getByRole("button", { name: /Été/ }).click();
    await expect(page.getByRole("img", { name: /Roulotte/i })).toBeVisible();
    await expect(page.getByText("10/10")).toBeVisible();
  });

  test("change de véhicule (ajout d'un VUS à 5 pneus)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Jeep GC & Roulotte/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder("Nom du véhicule").fill("VUS test");
    await page.getByRole("button", { name: "5 pneus seuls" }).click();
    await page.screenshot({ path: shotName(page, "vehicules"), fullPage: true });
    await page.getByRole("button", { name: "Ajouter ce véhicule" }).click();
    await expect(page.getByText("VUS test")).toBeVisible();
    await expect(page.getByText("5 pneus, sans roulotte")).toBeVisible();
    await expect(page.getByRole("img", { name: /Roulotte/i })).toHaveCount(0);
    await page.screenshot({ path: shotName(page, "vus"), fullPage: true });
    // Retour au Jeep (la saison d'été du Jeep ne doit pas avoir été écrasée)
    await page.getByRole("button", { name: /VUS test/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Jeep GC & Roulotte/ }).click();
    await expect(page.getByRole("img", { name: /Roulotte/i })).toBeVisible();
    await expect(page.getByText("Été · roulotte")).toBeVisible();
  });

  test("simule une crevaison et ouvre l'assignation sans Bluetooth", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Réglages" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /Simuler une crevaison sur AV G/ }).click();
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(page.getByRole("button", { name: /AV G.*16\.2/ })).toBeVisible();
    await expect(page.getByText("AV G · Pression basse")).toBeVisible();
    await expect(page.getByText("16.2")).toBeVisible();
    await page.screenshot({ path: shotName(page, "crevaison"), fullPage: true });

    await page.getByRole("button", { name: /Assigner les capteurs/ }).click();
    await expect(page.getByText(/Capteurs · Été/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Liste du système" })).toBeVisible();
    await page.getByRole("button", { name: "Liste du système" }).click();
    // Sans Web Bluetooth utilisable, un message d'erreur lisible doit apparaître (pas un plantage).
    await expect(page.getByText(/Bluetooth indisponible/)).toBeVisible();
    await page.screenshot({ path: shotName(page, "assigner"), fullPage: true });
  });
});

const ZEEPIN_35 = "000180eaca108a78e8ad0300e60a00005b00";

async function ingest(page: Page, ad: {
  deviceId: string;
  name?: string;
  rssi?: number | null;
  manufacturerData?: Record<string, string>;
  serviceUuids?: string[];
}) {
  await page.evaluate((payload) => {
    window.__pneuvueTest?.ingest({
      deviceId: payload.deviceId,
      name: payload.name ?? "",
      rssi: payload.rssi ?? -70,
      at: Date.now(),
      manufacturerData: payload.manufacturerData ?? {},
      serviceData: {},
      serviceUuids: payload.serviceUuids ?? [],
    });
  }, ad);
}

test.describe("PneuVue — écoute et identification", () => {
  test("écoute : capteur probable avec pression, Govee masqué", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Assigner les capteurs/ }).click();
    await page.getByRole("button", { name: "Écouter les capteurs" }).click();
    await expect(page.getByRole("heading", { name: "Écouter les capteurs" })).toBeVisible();
    await ingest(page, {
      deviceId: "aa:bb:cc:10:8a:78",
      name: "TPMS_8A78",
      rssi: -68,
      manufacturerData: { "0001": ZEEPIN_35 },
    });
    await ingest(page, { deviceId: "11:22:33:44:55:66", name: "Govee_H705D_0669", rssi: -50 });
    await expect(page.getByText("TPMS_8A78")).toBeVisible();
    await expect(page.getByText(/psi|kPa/).first()).toBeVisible();
    await expect(page.getByText("Govee_H705D_0669")).toHaveCount(0);
    await page.getByRole("button", { name: /Téléphones, montres et objets connus/ }).click();
    await expect(page.getByText("Govee_H705D_0669")).toBeVisible();
    await page.screenshot({ path: shotName(page, "ecoute"), fullPage: true });
  });

  test("écoute : tri par proximité, exclusion et surnom", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Assigner les capteurs/ }).click();
    await page.getByRole("button", { name: "Écouter les capteurs" }).click();
    await ingest(page, {
      deviceId: "aa:bb:cc:10:8a:78",
      name: "TPMS_8A78",
      rssi: -86,
      manufacturerData: { "0001": ZEEPIN_35 },
    });
    await ingest(page, { deviceId: "11:22:33:44:55:66", name: "Govee_H705D_0669", rssi: -46 });
    await ingest(page, { deviceId: "22:22:22:22:22:22", name: "Inconnu_AA", rssi: -64 });

    await page.getByRole("button", { name: "Proximité" }).click();
    const rows = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Pas un capteur" }) });
    await expect(rows.nth(0)).toContainText("Inconnu_AA");
    await expect(rows.nth(1)).toContainText("TPMS_8A78");
    await expect(page.getByText("Proche").first()).toBeVisible();
    await expect(page.getByText("Loin").first()).toBeVisible();
    await page.getByRole("button", { name: /Téléphones, montres et objets connus/ }).click();
    await expect(page.getByText("Govee_H705D_0669")).toBeVisible();
    await expect(page.getByText("Très proche").first()).toBeVisible();
    await expect(page.getByText("-46 dBm")).toBeVisible();
    await page.screenshot({ path: shotName(page, "ecoute-proximite"), fullPage: true });

    await page.getByRole("listitem").filter({ hasText: "Govee_H705D_0669" }).getByRole("button", { name: "Pas un capteur" }).click();
    await expect(page.getByText("Govee_H705D_0669")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Appareils cachés \(1\)/ })).toBeVisible();
    await page.screenshot({ path: shotName(page, "ecoute-caches"), fullPage: true });

    await page.getByRole("button", { name: /Appareils cachés \(1\)/ }).click();
    await expect(page.getByText("Govee_H705D_0669")).toBeVisible();
    await page.getByRole("button", { name: "Restaurer", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Govee_H705D_0669" })).toBeVisible();

    const tpms = page.getByRole("listitem").filter({ hasText: "TPMS_8A78" });
    await tpms.getByRole("button", { name: "Assigner à une roue" }).click();
    await tpms.getByRole("button", { name: "AV G", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "aa:bb:cc:10:8a:78" })).toContainText("Capteur roue AV G");

    await page.getByRole("listitem").filter({ hasText: "aa:bb:cc:10:8a:78" }).getByRole("button", { name: "Renommer" }).click();
    await page.locator("#pneuvue-surnom").fill("Capteur avant");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "aa:bb:cc:10:8a:78" })).toContainText("Capteur avant");
    await page.screenshot({ path: shotName(page, "ecoute-surnom"), fullPage: true });
  });

  test("écoute : identifiant enregistré, recherche et pression en bar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Assigner les capteurs/ }).click();
    await page.getByRole("button", { name: "Écouter les capteurs" }).click();
    await page.getByLabel("Identifiant", { exact: true }).fill("3A1F2C");
    await page.getByLabel("Surnom", { exact: true }).fill("Capteur roue AR G INT");
    await page.getByRole("button", { name: "Enregistrer l'identifiant" }).click();
    await ingest(page, {
      deviceId: "aa:bb:cc:3a:1f:2c",
      name: "",
      rssi: -60,
      manufacturerData: { "00ff": "00aa3a1f2cbb" },
    });
    await expect(page.getByRole("listitem").filter({ hasText: "aa:bb:cc:3a:1f:2c" })).toContainText("Capteur roue AR G INT");
    await expect(page.getByText("Probable").first()).toBeVisible();
    await page.getByLabel("Chercher un identifiant").fill("2C1F3A");
    await expect(page.getByRole("listitem").filter({ hasText: "aa:bb:cc:3a:1f:2c" })).toContainText("Capteur roue AR G INT");
    await ingest(page, {
      deviceId: "66:35:6C:81:AB:F8",
      name: "",
      rssi: -55,
      manufacturerData: { "004c": "10063e1e3b9561a00100000000000000000000000080000000" },
    });
    await expect(page.getByText("12,3 psi")).toHaveCount(0);
    await expect(page.getByText("15,5 psi")).toHaveCount(0);
    await page.screenshot({ path: shotName(page, "ecoute-identifiant"), fullPage: true });
  });

  test("identifier : rapprocher le téléphone propose le capteur le plus proche", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Assigner les capteurs/ }).click();
    await page.getByRole("button", { name: "Identifier un capteur" }).click();
    await expect(page.getByRole("heading", { name: "Identifier un capteur" })).toBeVisible();
    await page.getByRole("button", { name: /Rapprocher le téléphone/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Avant gauche/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText(/Colle le téléphone|Reste d'abord/)).toBeVisible();
    await page.screenshot({ path: shotName(page, "identifier-consignes"), fullPage: true });

    // On injecte avant/pendant : le test accélère le timer en appelant le résultat via plusieurs ads
    // après Démarrer. Pour un test déterministe, on enchaîne Démarrer puis on injecte tout de suite
    // (le module de scan unique reçoit les mêmes annonces).
    await page.getByRole("button", { name: "Démarrer" }).click();
    await expect(page.getByText(/Signal de base|Colle le téléphone|On mémorise/)).toBeVisible();
    // Baseline : capteur loin, Govee fort
    for (let i = 0; i < 4; i++) {
      await ingest(page, { deviceId: "aa:bb:cc:10:8a:78", name: "TPMS_8A78", rssi: -82, manufacturerData: { "0001": ZEEPIN_35 } });
      await ingest(page, { deviceId: "11:22:33:44:55:66", name: "Govee_H705D_0669", rssi: -55 });
    }
    // La phase proche arrive après 5 s — on attend le texte, puis on injecte un RSSI beaucoup plus fort.
    await expect(page.getByText("Colle le téléphone sur la valve", { exact: true })).toBeVisible({ timeout: 8000 });
    for (let i = 0; i < 6; i++) {
      await ingest(page, { deviceId: "aa:bb:cc:10:8a:78", name: "TPMS_8A78", rssi: -48, manufacturerData: { "0001": ZEEPIN_35 } });
      await ingest(page, { deviceId: "11:22:33:44:55:66", name: "Govee_H705D_0669", rssi: -54 });
    }
    await expect(page.getByText(/Meilleur candidat/i)).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("TPMS_8A78")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assigner à cette roue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await page.screenshot({ path: shotName(page, "identifier-resultat"), fullPage: true });
  });
});
