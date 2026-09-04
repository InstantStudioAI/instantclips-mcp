# MCP de InstantClips

[English](README.md) · **Español** · [简体中文](README.zh-CN.md)

[![M8ven Verified](https://m8ven.ai/badge/mcp/instantclips-mcp-1k56q7?variant=verified)](https://m8ven.ai/mcp/instantclips-mcp-1k56q7)

[InstantClips](https://instantclips.ai) convierte un producto de comercio electrónico en vídeos
verticales cortos para TikTok, Instagram Reels y Stories. Funciona como un **servidor MCP alojado**,
por lo que Claude Code, Codex, Cursor, VS Code, la aplicación de Claude, ChatGPT o cualquier otro
cliente MCP pueden hacer lo mismo que la aplicación web: importar un producto, preparar la
dirección creativa y renderizar el vídeo.

**El servidor del producto permanece alojado.** Este repositorio contiene su guía de conexión, los
metadatos de registro, un cliente HTTP de ejemplo y un pequeño adaptador stdio de código abierto
para los clientes que no pueden conectarse directamente a un servidor remoto. El adaptador responde
localmente a la inicialización, al ping y al descubrimiento de herramientas desde una instantánea
generada, y envía al endpoint alojado únicamente las llamadas autenticadas. El servidor alojado
sigue siendo la fuente de verdad; la implementación del producto no se duplica aquí.

## Endpoint

|            |                                            |
| ---------- | ------------------------------------------ |
| Endpoint   | `https://app.instantclips.ai/mcp`          |
| Transporte | Streamable HTTP, sin estado                |
| Método     | `POST`, JSON-RPC 2.0                       |
| Auth       | `Authorization: Bearer <token>`            |

Genera un token en **[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**.
El token da acceso a tu propia cuenta: las mismas marcas, productos, créditos y límites del plan
que en la aplicación web. Al iniciar sesión se crea una cuenta si todavía no tienes una, con
créditos gratuitos para empezar.

Al abrir el endpoint en un navegador, aparece la página de configuración en lugar de un error de
protocolo, con botones de instalación de un clic que introducen el token por ti.

## Instalación

Conéctate directamente al endpoint alojado siempre que tu cliente admita Streamable HTTP. Usa el
adaptador stdio descrito abajo solo para clientes y procesos automatizados que requieran un comando
local.

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

### Codex

Añade lo siguiente a `~/.codex/config.toml`; la configuración se aplica a la CLI, la aplicación y
la extensión del IDE:

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

Para no guardar el token en el archivo, sustituye el encabezado por
`bearer_token_env_var = "INSTANTCLIPS_TOKEN"` y expórtalo como variable de entorno en tu shell.

### Clientes que solo admiten stdio y procesos sin interfaz

El paquete npm `instantclips-mcp` es un adaptador ligero de stdio a HTTPS. Sirve localmente la
inicialización y el descubrimiento de herramientas para arrancar rápido y sin credenciales; después
lee el token del entorno y envía las llamadas de herramientas a InstantClips:

```json
{
  "mcpServers": {
    "instantclips": {
      "command": "npx",
      "args": ["-y", "instantclips-mcp"],
      "env": {
        "INSTANTCLIPS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

Para comprobar la conexión de forma automatizada, incluidos los nombres actuales de las
herramientas:

```bash
INSTANTCLIPS_TOKEN="your-token" npx -y instantclips-mcp --check --json
```

El token solo se acepta mediante `INSTANTCLIPS_TOKEN`, nunca como argumento de línea de comandos,
por lo que no aparece en la lista de procesos. Es obligatorio para llamar a una herramienta, pero
no para `initialize`, `ping` ni `tools/list`. Se requiere Node.js 20 o posterior.

### Cursor y VS Code

La [página de configuración](https://app.instantclips.ai/settings#ai-access) incluye botones de
instalación de un clic. Una vez generado el token, los botones lo introducen por ti.

### Aplicación de Claude y ChatGPT

Estos clientes se conectan mediante su propia configuración de conectores, no mediante un archivo.
Apunta el conector a `https://app.instantclips.ai/mcp` y autentícate con el mismo token: como
encabezado de solicitud en Claude y como clave de API en ChatGPT. Los encabezados de solicitud de
Claude siguen en beta y ChatGPT requiere el modo de desarrollador; su disponibilidad depende de tu
cuenta y de las políticas de tu espacio de trabajo.

### Cualquier otro cliente

OpenClaw, Hermes o un agente que hayas creado: conéctalo a la URL mediante Streamable HTTP con un
encabezado `Authorization: Bearer`. El protocolo no contiene nada específico de InstantClips, por
lo que cualquier cliente compatible con MCP ya puede comunicarse con el servidor.

## Herramientas

El flujo de trabajo, en orden:

1. **Importar** — usa `import_product_from_url` para una página de tienda o
   `create_product_from_images` cuando no haya una página que leer.
2. **Esperar el borrador** — consulta `get_product` periódicamente hasta que terminen la importación
   y la preparación de la dirección creativa.
3. **Revisarlo y orientarlo** — la dirección se devuelve como texto: gancho, enfoque del contenido,
   formato, pautas de ejecución y restricciones. `update_video_direction` permite editarla y
   `redraft_video_direction` propone otro enfoque.
4. **Renderizar** — usa `generate_video`.
5. **Recoger el resultado** — consulta `get_video` periódicamente para obtener el MP4 terminado y
   un enlace público para compartirlo.

Las marcas funcionan de la misma manera: `list_brands`, `create_brand`, `set_product_brand`. Cada
vídeo se prepara con la voz de una marca; por eso, si el escaparate de un producto importado no
coincide con ninguna marca existente, el proceso se detiene y pregunta en lugar de adivinar.

El servidor alojado publica los parámetros exactos de cada herramienta. La instantánea generada
[`manifest/instantclips-mcp.json`](manifest/instantclips-mcp.json) permite que clientes stdio y
registros inspeccionen los mismos esquemas sin credenciales. Quienes mantienen el repositorio la
actualizan con `INSTANTCLIPS_TOKEN="..." npm run sync:manifest`; `npm run check:manifest` falla si
la copia incluida difiere del servidor en producción. Ejecuta `python example.py tools` cuando
quieras imprimir específicamente los esquemas actuales mediante HTTP.

## Créditos

Importar un producto, preparar la dirección creativa y editarla es **gratis**. `generate_video` es
la única herramienta que consume créditos y requiere tu autorización explícita; las herramientas
indican antes el coste. Un agente no puede acumular cargos sin avisarte. Consulta los
[precios](https://instantclips.ai/#pricing).

## example.py

Un cliente MCP sin dependencias: solo requiere Python 3.9 o posterior y la biblioteca estándar; no
hace falta ejecutar `pip install`.

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # todas las herramientas, con su esquema de entrada actual
python example.py call list_brands '{}' # llama a una herramienta con argumentos JSON
```

Ejecuta primero `tools`: muestra los nombres y tipos de parámetros reales de cada herramienta, que
es lo que necesitas antes de automatizar el flujo de trabajo descrito arriba.

## Enlaces

- [instantclips.ai/automate](https://instantclips.ai/automate/) — qué es la automatización y para
  qué sirve. No repite la configuración; esa información está en este archivo y en la página de
  configuración de la aplicación.
- [app.instantclips.ai/llms.txt](https://app.instantclips.ai/llms.txt) — descripción del producto y
  de la secuencia de herramientas en un formato legible por máquinas.
- [Términos](https://app.instantclips.ai/terms) · [Privacidad](https://app.instantclips.ai/privacy)

## Registro

`server.json` es la entrada de este servidor en el
[registro oficial de MCP](https://registry.modelcontextprotocol.io), del que se alimentan los demás
directorios. Una sola entrada, `ai.instantclips/instantclips`, contiene tanto el endpoint alojado en
`remotes` como el adaptador stdio en `packages`. Así, cada cliente puede elegir el transporte que
admita sin crear dos identidades para el mismo conjunto de herramientas.

El valor `mcpName` del paquete npm debe coincidir exactamente con ese nombre del registro. El enlace
al repositorio apunta al adaptador de código abierto; la implementación alojada del producto no se
encuentra en este repositorio.

El espacio de nombres `ai.instantclips` es el DNS inverso del dominio, por lo que debe publicarse
mediante autenticación del dominio por DNS o HTTP, no mediante GitHub. Autenticarse con GitHub
obligaría a usar `io.github.instantstudioai/...` y a renunciar al espacio de nombres de la marca.

Publica primero el paquete npm y, después de incrementar `version`, vuelve a publicar esta misma
entrada del registro con `mcp-publisher publish`. La autenticación del dominio conserva el espacio
de nombres de marca `ai.instantclips`; no lo sustituyas por un nombre `io.github.*`. La clave de
firma no se guarda en el repositorio: `.gitignore` cubre `*.pem`, y una clave privada incluida en un
commit es una clave publicada.

`glama.json` es el archivo independiente y específico de Glama que permite reclamar allí la ficha.
Un servidor perteneciente a una organización, en lugar de una cuenta personal, solo puede
reclamarse si ese archivo está presente.
El archivo solo acredita la propiedad. En el formulario Dockerfile de Glama, usa
`["npm install --omit=dev"]` como pasos de compilación,
`["node", "./bin/instantclips-mcp.js"]` como argumentos de CMD y cualquier valor ficticio para el
marcador obligatorio `INSTANTCLIPS_TOKEN`. Las comprobaciones de inicialización y calidad de Glama
usan el manifiesto incluido y nunca envían ese valor al servidor alojado. No introduzcas un token
real de una cuenta en el entorno de compilación de un tercero.

## Licencia

MIT — consulta [LICENSE](LICENSE). La licencia cubre el contenido de este repositorio; el uso del
servicio alojado se rige por los [Términos de servicio](https://app.instantclips.ai/terms).
