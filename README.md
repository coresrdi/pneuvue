# PneuVue

Application web de suivi de pression (Jeep + roulotte 25 pi).

Ce n'est pas un APK Google Play. Les pressions affichées sont simulées tant que les capteurs ne sont pas calibrés.

## Voir le code

- Écran principal : [src/components/tpms/pneu-app.tsx](src/components/tpms/pneu-app.tsx)
- Données et saisons : [src/lib/tpms/store.ts](src/lib/tpms/store.ts)
- Bluetooth : [src/lib/tpms/bluetooth.ts](src/lib/tpms/bluetooth.ts)

Télécharger tout le dépôt : https://github.com/coresrdi/pneuvue/archive/refs/heads/main.zip

## Application Android (branche `android-play`)

Le dépôt d'origine ne contenait que les écrans, sans `package.json` ni modules du prévisualiseur (`AuthProvider`, `PreviewHostBridge`). Cette branche reconstruit une application web **SPA statique** (Vite + React) qui fonctionne hors ligne, sans serveur ni compte.

- Lancer en local : `npm install && npm run dev`
- Tests : `npm test` (logique) et `npm run test:e2e` (Playwright)
- Emballage Android (Capacitor), identifiant `com.coresrdi.pneuvue`
- Bluetooth : plugin natif `@capacitor-community/bluetooth-le` dans l'app, Web Bluetooth dans Chrome. Voir [docs/ble-tpms.md](docs/ble-tpms.md).
