# PokéShop (Tauri + React + Tailwind)

Aplicación de escritorio para generar una tienda aleatoria de Pokémon por regiones y tiers. Permite compras con moneda ficticia, rerolls limitados y un historial de acciones. Toda la configuración (regiones, cuotas de tiers, tamaños, colores, recarga de rerolls, etc.) es externa y editable por el usuario. Los datos y el estado (dinero, tiendas por región, compras, rerolls, región activa…) persisten entre sesiones.
Incluye soporte de sprites por defecto (1–1000) y sprites personalizados en una carpeta de configuración que sobrescriben los de serie.

## Tabla de Contenidos

-   [Características](#características)
-   [Stack](#stack)
-   [Requisitos](#requisitos)
-   [Instalación y arranque](#instalación-y-arranque)
-   [Build de producción](#build-de-producción)
-   [Estructura relevante](#estructura-relevante)
-   [Configuración (config.json)](#configuración-configjson)
-   [Datos de Pokémon (pokemon.json)](#datos-de-pokémon-pokemonjson)
-   [Sprites](#sprites)
    -   [Ruta por defecto](#ruta-por-defecto)
    -   [Sprites personalizados y sobreescritura](#sprites-personalizados-sobrescritura)
-   [Distribución por porcentajes (tierWeights)](#distribución-por-porcentajes-tierweights)
-   [Reglas de tienda y rerolls](#reglas-de-tienda-y-rerolls)
-   [Historial y Deshacer](#historial-y-deshacer)
-   [Consejos y resolución de problemas](#consejos-y-resolución-de-problemas)
-   [Licencia](LICENSE)

## Características

-   **Tienda por región** con tamaño configurable (por defecto 10).
-   **Cuotas mínimas por tier** (S, A, B, C…): garantizan unidades mínimas.
-   **Porcentajes por tier** para rellenar el resto de la tienda (p. ej. C 40%, B 30%, A 20%, S 10%).
-   **Persistencia por región**: al volver a una región, la misma tienda (con compras y estado) reaparece.
-   **Rerolls globales**: contador único y configurable. Posibilidad de recarga cada N regiones distintas visitadas.
-   **Ciclos de tienda**: la tienda de una región se mantiene igual durante N cambios de región (configurable); pasado el ciclo, puede regenerarse automáticamente al volver a entrar.
-   Historial de compras, rerolls, cambios de región y ajustes de dinero.
-   Deshacer la última acción.
-   **Sprites**: imágenes por ID con fallback; el usuario puede poner sprites propios que sobrescriben los de serie.
-   Tema oscuro con estética simple y familiar de Pokémon (borde por color según tier, configurable).

## Stack

-   **Tauri** (bundle nativo: .exe, .msi, .app, .deb, …)
-   **React** + **Vite**
-   **Tailwind CSS v4**
-   **Zustand** (estado global con persistencia)
-   **TypeScript**

## Requisitos

-   **Node.js** 18+
-   **Rust** (stable) + toolchain para Tauri
-   En Windows: **Microsoft C++ Build Tools**
-   Gestor de paquetes: `pnpm` (recomendado) o `npm`

## Instalación y arranque

```bash
# Instalar dependencias
pnpm install   # o npm install

# Desarrollo
pnpm tauri dev # abre la app con hot reload
```

> La app crea/usa la carpeta de configuración del sistema (**Tauri** `appConfigDir`).
> Puedes abrirla desde **Ajustes → Abrir carpeta de configuración**.

## Build de producción

```bash
# Build de producción (genera instalador / ejecutable)
pnpm tauri build
```

El ejecutable/instalador se genera en `src-tauri/target/release/bundle/…` según tu plataforma.

## Estructura relevante

```bash
src/
  components/
    TopBar.tsx
    PokemonRow.tsx
    HistoryPanel.tsx
    PurchasesPanel.tsx
    SettingsPanel.tsx
    SpriteImg.tsx # carga sprites (custom o default)
  lib/
    config.ts # lectura/escritura config y datos, abrir carpetas
    sprites.ts # utilidades sprites (override por carpeta)
    storeLogic.ts # reglas de tienda/rerolls y utilidades
    random.ts
  store/
    useShopStore.ts # estado global (persistente) con lógica de negocio
  types.ts # tipos compartidos
public/
  sprites-default/ # sprites por defecto + fallbacks
```

## Configuración (config.json)

La app crea y/o usa la carpeta de configuración del sistema (Tauri `appConfigDir`).
Desde la aplicación puedes abrirla en **Ajustes → Abrir carpeta de configuración**.

Campos soportados:

```js
{
    "shopSize": 10, // tamaño de la tienda
    "quota": { "S": 1, "A": 1, "B": 1, "C": 2 }, // mínimos garantizados por tier
    "tierWeights": { "C": 40, "B": 30, "A": 20, "S": 10 }, // porcentajes para rellenar el resto

    "regionsOrder": ["Kanto", "Johto", "Hoenn", "Sinnoh"],

    "rerollsPerRegion": 2,

    // Rerolls: recarga cuando se hayan visitado N REGIONES DISTINTAS desde la última recarga.
    // -1 = nunca recargar por cambiar de región
    "rerollRechargeEveryRegions": 3,

    // Tienda: cada región mantiene su tienda durante N CAMBIOS de región
    // (se evalúa por región con un "contador" de movimientos). -1 = nunca auto-regenerar.
    "shopRefreshEveryRegions": 2,

    // Si haces "Actualizar" manual: ¿resetear rerolls?
    "rerollResetOnRefresh": false,

    // ¿Permitir duplicados visibles simultáneamente en tienda?
    "allowDuplicates": false,

    // Fichero de datos externos (lista de Pokémon). Se guarda junto al config.json.
    "dataFile": "pokemon.json",

    // Colores de borde por tier
    "tierColors": {
        "S": "#f59e0b",
        "A": "#8b5cf6",
        "B": "#3b82f6",
        "C": "#22c55e"
    },
    "defaultTierColor": "#9ca3af",

    // Si true, los comprados pueden volver a salir en un reroll
    "includePurchasedInRerollPool": false,
    // Si true, la tienda se autofillea al comprar un pokémon
    "shopBuySlotAutofill": "false"
}
```

> Notas
>
> -   Si la suma de quota excede shopSize, se ajusta empezando por tiers de menor prioridad.
> -   Si falta stock para un tier, se muestran huecos (“No hay pokémon de este tier disponibles”) sin consumir reroll al reintentar.
> -   Los colores por tier pueden cambiarse a tu gusto.

## Datos de Pokémon (pokemon.json)

Se carga desde la carpeta de configuración (junto a `config.json`).
Estructura:

```json
[
    {
        "id": 1,
        "nombre": "Bulbasaur",
        "tier": "C",
        "precio": 200,
        "regiones": ["Kanto"]
    },
    {
        "id": 25,
        "nombre": "Pikachu",
        "tier": "B",
        "precio": 500,
        "regiones": ["Kanto, Johto, Hoenn"]
    },
    {
        "id": 150,
        "nombre": "Mewtwo",
        "tier": "S",
        "precio": 5000,
        "regiones": ["Kanto"]
    }
]
```

-   `id`: número único (coincide con el nombre del sprite id.png)
-   `nombre`: Nombre del pokémon
-   `tier`: “S” > “A” > … > “Z”
-   `precio`: Precio del pokémon en la tienda
-   `regiones`: una o varias

> [!NOTE]  
> Por defecto hay una lista de pokémon con **información aleatoria** como ejemplo, no están todos los pokémon ni sus regiones correspondientes.

## Sprites

### Ruta por defecto

Coloca los sprites “de serie” (si los usas en tu repo) en:

```bash
public/sprites-default/{id}.png
public/sprites-default/missing.png   # fallback si no existe el id
public/sprites-default/empty.png     # para huecos (slots -1)
```

### Sprites personalizados (sobrescritura)

En la carpeta de configuración, la app crea una subcarpeta `sprites`, donde puedes poner tus sprites personalizados:

```bash
<appConfigDir>/sprites/
  1.png
  2.png
  25.png
  ...
```

Si existe `sprites/{id}.png`, sobrescribe al de `public/sprites-default/{id}.png`.
Puedes abrir esta carpeta desde **Ajustes → Abrir carpeta de sprites**.

> [!TIP]
> Para comprobar que se ha actualizado solamente tienes que hacer F5 en la aplicación

## Distribución por porcentajes (tierWeights)

Además de los mínimos garantizados por `quota`, la tienda rellena el resto de huecos en base a **porcentajes por tier**:

-   `quota` fija los **mínimos** por tier (si un tier no tiene stock, se verá como hueco).
-   `tierWeights` reparte el **resto** de slots mediante **muestreo ponderado**.
-   Los porcentajes se **normalizan** (no es obligatorio que sumen 100).
-   Por defecto: `C 40%`, `B 30%`, `A 20%`, `S 10%`.

Ejemplo

```json
"shopSize": 10,
"quota": { "S": 1, "A": 1, "B": 1, "C": 2 },
"tierWeights": { "C": 40, "B": 30, "A": 20, "S": 10 }
```

1. Se garantizan **1 Tier S**, **1 Tier A**, **1 Tier B**, **2 Tier C**, hay 5 slots cubiertos.
2. Quedan **5** slots libres, a cada slot se asigna a un tier aleatorio ponderado por `tierWeights`.
   Puede salir **más o menos** de un tier respecto a la cuota mínima.

La tienda se muestra **ordenada de mejor a peor tier**.

## Reglas de tienda y rerolls

-   **Persistencia por región**
    -   Cada región guarda su **propia tienda** (con compras, rerolls consumidos, etc.).
    -   Con `shopRefreshEveryRegions = N`, una región **permanece igual** durante **N cambios de región** desde su última regeneración. Al superarse ese umbral y volver a entrar, puede regenerarse automáticamente.
-   **Rerolls (globales)**
    -   Tienes `rerollsPerRegion` como **máximo global** (visibles en la barra superior).
    -   Con `rerollRechargeEveryRegions = R`, al visitar **R regiones distintas** (dentro del ciclo actual) los rerolls **se recargan** (vuelven a 0 usados) y empieza un nuevo ciclo. Volver a una región ya contada no suma.
    -   Si un reroll **no encuentra candidato** válido (por restricciones de duplicados, comprados excluidos, etc.), **no se consume** y se muestra un **aviso breve**.
-   **Compras**
    -   Un Pokémon comprado queda marcado como **Comprado** en su slot. En el caso de que tengas la opción de `shopBuySlotAutofill` se rellena automáticamente.
    -   La lista de **Compras** muestra nombre, tier, precio, región y fecha.

## Historial y Deshacer

-   **Historial**: Registra compras, rerolls, cambios de región, modificaciones de saldo y acciones deshechas.
-   **Deshacer**: Revierte el último cambio de estado (compra, reroll, actualizar, establecer región…).

## UI / Uso

-   **Barra superior**: selección de región, aplicar/actualizar, deshacer, dinero y rerolls.
-   **Ajustes**: sumar/restar dinero, abrir carpetas (config/sprites), borrar datos (con confirmación).
-   **Historial** (acciones) y **Compras** (registro con miniaturas).
-   **Tienda**: cada fila muestra sprite, nombre, tier, precio, **Comprar** y **Reroll**.
    -   Si el slot está comprado, se muestra “**Comprado**”.
    -   Si no hay Pokémon disponibles de ese tier, se muestra un mensaje y el slot queda deshabilitado (o aviso temporal al rerollear, según el caso).

## Consejos y resolución de problemas

-   Si Tailwind da errores de PostCSS, asegúrate de usar la **configuración recomendada** para Tailwind v4 y Vite.
-   Si no aparece nada al iniciar, revisa que existan `config.json` y `pokemon.json` en la carpeta de configuración (la app los genera por defecto).
-   Usa los botones de **Ajustes** para abrir rápidamente las carpetas o borrar datos.
