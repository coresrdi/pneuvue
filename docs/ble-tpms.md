# Décodage des annonces BLE des capteurs TPMS

PneuVue lit les pressions **sans connexion** (annonce BLE seulement), ce qui épargne la pile des capteurs.

## Format principal (générique / ZEEPIN / TP630 / Theengs « TPMS »)

Identifié par l'identifiant fabricant `0x0001` ou `0x0100` et un payload de 16 octets
(18 si l'identifiant fabricant est inclus au début).

| Octets (payload 16 o.) | Contenu |
| --- | --- |
| 0 | Numéro de capteur (`0x80` = 1, `0x81` = 2, …) |
| 1–2 | Préfixe d'adresse |
| 3–5 | Adresse du capteur (souvent les 3 derniers octets de l'adresse MAC) |
| 6–9 | Pression, entier 32 bits little-endian. kPa = valeur / 1000. Psi = kPa × 0,145037737 |
| 10–13 | Température, entier 32 bits signé little-endian. °C = valeur / 100 |
| 14 | Pile, en % |
| 15 | Alarme (`0` = ok, `1` = pas de pression) |

Exemple documenté (ra6070/BLE-TPMS) :

```
000180EACA108A78E36D0000E60A00005B00
```

(identifiant `0001` + 16 octets. Température 27,90 °C, pile 91 %. La pression de cet exemple est basse : c'est un échantillon, pas une valeur typique de route.)

Sources : [ra6070/BLE-TPMS](https://github.com/ra6070/BLE-TPMS), [Theengs Decoder TPMS](https://decoder.theengs.io/devices/TPMS.html), retours Home Assistant (manufacturer `0100`).

## Format secondaire (certains capteurs, fabricant `0x1E20`, 5 octets)

Observé sur d'autres lots AliExpress / « TPMS BLE » :

- octet 0 : température en °C (entier signé)
- octets 1–2 : pression big-endian × 0,005 bar
- la tension / pile n'est pas toujours dans le même champ : si elle est absente ou hors 0–100, on affiche 100 % par défaut et on le note comme estimé

Ce format n'est retenu que si les valeurs passent un contrôle de vraisemblance (0–200 psi, −50 à 150 °C).

## Si le format n'est pas reconnu

L'appairage (nom ou identifiant du capteur) reste possible. Tant qu'aucune annonce décodable n'arrive, PneuVue affiche les pressions **simulées** si la simulation est activée, avec la mention « Simulation des pressions ». Dès qu'une annonce valide correspond à un capteur assigné, la carte passe en « En direct ».

Le protocole exact dépend du modèle acheté : si tes capteurs ne sont pas reconnus, un échantillon d'annonce (octets manufacturer data) permettra d'ajouter leur format.


## UUID de service (classification, sans décodage de pression)

Beaucoup de capteurs « bouchon de valve » annoncent un UUID 16 bits typique, même quand le payload n'est pas au format ZEEPIN :

| UUID | Usage courant |
| --- | --- |
| `0xFBB0` | TPMS BLE génériques (plusieurs usines / applis Android) |
| `0x27A5` | Autre famille fréquente de capteurs TPMS BLE |

PneuVue classe alors l'appareil comme **capteur de pneu probable**, enregistre le manufacturer data et le service data en hex, et affiche la pression seulement si un format connu est aussi présent.

Les noms `TPMS`, `ZEEPIN`, `SYTPMS`, `BR_…` sont également considérés comme probables.

## Classification et journal

Pendant l'écoute (15 à 30 min) et l'identification, un seul module de scan passif (`requestLEScan`, sans sélecteur natif) enregistre chaque appareil : adresse, nom, RSSI, nombre d'annonces, dernière vue, données brutes, valeurs décodées.

- **Probable** : format connu, UUID FBB0/27A5, ou nom typique.
- **Possible** : l'annonce change périodiquement (souvent si le véhicule roule) et n'est pas une marque connue (Govee, etc.).
- **Autres** : masqués par défaut derrière « Afficher tous les appareils ».

Le journal se copie en texte ou en JSON pour ajouter un format encore inconnu à partir des octets.

## Limites

Le scan BLE d'une application Android s'arrête souvent quand l'app passe en arrière-plan ou que l'écran se verrouille, sauf service de premier plan (non utilisé ici). Garde PneuVue ouvert. L'écran est maintenu allumé pendant une écoute ou une identification.
