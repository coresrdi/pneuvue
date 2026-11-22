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
    await expect(page.getByRole("button", { name: /Choisir/ })).toBeVisible();
    await page.getByRole("button", { name: /Choisir/ }).click();
    // Sans Web Bluetooth utilisable, un message d'erreur lisible doit apparaître (pas un plantage).
    await expect(page.getByText(/Bluetooth indisponible/)).toBeVisible();
    await page.screenshot({ path: shotName(page, "assigner"), fullPage: true });
  });
});
