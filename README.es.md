# MCP de InstantClips

[English](README.md) · **Español** · [简体中文](README.zh-CN.md)

[![M8ven Verified](https://m8ven.ai/badge/mcp/instantclips-mcp-1k56q7?variant=verified)](https://m8ven.ai/mcp/instantclips-mcp-1k56q7)

[InstantClips](https://instantclips.ai) convierte un producto de comercio electrónico en vídeos
verticales cortos para TikTok, Instagram Reels y Stories. Funciona como un **servidor MCP alojado**,
por lo que Claude Code, Codex, Cursor, VS Code, la aplicación de Claude, ChatGPT o cualquier otro
cliente MCP pueden hacer lo mismo que la aplicación web: importar un producto, preparar el plan y
generar el vídeo.

**No es un generador de texto a vídeo.** InstantClips lee la página del producto (fotos, precio,
detalles) y construye el anuncio a partir de lo que realmente hay allí. El plan se escribe primero
y se te muestra; el vídeo sigue el plan. Por eso resulta lo bastante económico para recorrer un
catálogo entero, y por eso el resultado es el producto que vendes y no una suposición.

Gratis para empezar: los créditos de bienvenida cubren el primer vídeo y no hace falta introducir
ninguna tarjeta. Después, paquetes de créditos de pago único o una membresía Agency para quien
gestiona varias marcas. Consulta los [precios](https://instantclips.ai/#pricing).

- **Dónde encaja.** Junto a un programador de publicaciones (Postiz, Buffer) que publique lo que
  se genera. Junto a una herramienta de atribución que te diga qué gancho funcionó. En lugar de un
  editor cuando tienes una página de producto y ningún metraje.
- **Para qué no sirve.** Películas cinematográficas de marca. Un presentador leyendo tu guion.
  4K horizontal. Productos sin página y sin fotos.
- **Pensado para.** Vendedores de Shopify, dropshippers, marcas y agencias que llevan las redes de
  varias tiendas a la vez.

**El servidor del producto permanece alojado.** Este repositorio contiene su guía de conexión, los
metadatos de registro, un cliente HTTP de ejemplo y un pequeño adaptador stdio de código abierto
para los clientes que no pueden conectarse directamente a un servidor remoto. El adaptador responde
localmente a la inicialización, al ping y al descubrimiento de herramientas desde una instantánea
generada, y envía al endpoint alojado únicamente las llamadas autenticadas. El servidor alojado
sigue siendo la fuente de verdad; la implementación del producto no se duplica aquí.

## Endpoint

|            |                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Endpoint   | `https://app.instantclips.ai/mcp`                                                                 |
| Transporte | Streamable HTTP, sin estado                                                                       |
| Método     | `POST`, JSON-RPC 2.0                                                                              |
| Auth       | Inicio de sesión cuando el cliente lo pida (OAuth 2.1), o `Authorization: Bearer <token>` para procesos sin navegador |

Pega una sola dirección en tu asistente e inicia sesión cuando te lo pida. Esa es toda la
configuración. La primera vez que llama, el servidor te lleva a iniciar sesión en InstantClips y a
autorizar al asistente; no hay claves que copiar. Cada asistente que autorizas aparece en
**Aplicaciones autorizadas** dentro de los ajustes, donde puedes desconectarlo.

La conexión es con tu propia cuenta: las mismas marcas, productos, créditos y límites del plan que
en la aplicación web. Al iniciar sesión se crea una cuenta si todavía no tienes una, con créditos
para el primer vídeo.

Al abrir el endpoint en un navegador aparece la
[página de configuración](https://app.instantclips.ai/mcp) en lugar de un error de protocolo, con
botones de instalación de un clic para Cursor y VS Code.

## Instalación

Conéctate directamente al endpoint alojado siempre que tu cliente admita Streamable HTTP; te
guiará por el inicio de sesión la primera vez. Usa un token y el adaptador stdio (en «¿Sin
navegador?», más abajo) solo para scripts y procesos automatizados que no pueden abrir una página
de inicio de sesión.

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp
```

Después ejecuta `/mcp` dentro de Claude Code y elige InstantClips para iniciar sesión.

### Codex

Añade lo siguiente a `~/.codex/config.toml`; la configuración se aplica a la CLI, la aplicación y
la extensión del IDE:

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
```

Después ejecuta `codex mcp login instantclips` para iniciar sesión.

### Cursor y VS Code

La [página de configuración](https://app.instantclips.ai/mcp) incluye botones de instalación de un
clic. Abren la aplicación, añaden InstantClips y te piden iniciar sesión la primera vez.

### Aplicación de Claude y ChatGPT

Aplicación de Claude: añade un conector personalizado con esta dirección e inicia sesión cuando te
lo pida. ChatGPT en la web: activa el modo de desarrollador en Ajustes, Apps, Avanzado y añade la
dirección como conector; en un espacio de trabajo Business o Enterprise, un administrador la
publica como aplicación para todo el equipo. La aplicación de escritorio de ChatGPT acepta la misma
dirección en Ajustes, Servidores MCP, y la comparte con Codex.

### Cualquier otro cliente o agente MCP

OpenClaw, Hermes o un agente que hayas creado: conéctalo a la dirección mediante Streamable HTTP.
El servidor anuncia su flujo de inicio de sesión de la forma estándar, así que un cliente que siga
la especificación no necesita nada más. Lo que no pueda abrir una página de inicio de sesión usa un
token, como se explica a continuación.

### ¿Sin navegador? Usa un token de acceso

Los scripts, los trabajos de CI y los agentes que no pueden abrir una página de inicio de sesión se
autentican con un token de larga duración. Genera uno en
**[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**. Da
acceso completo a tu cuenta, así que mantenlo fuera de cualquier cosa que subas a un repositorio.

Con un token, los mismos clientes quedan así:

```bash
# Claude Code
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

```toml
# Codex, en ~/.codex/config.toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

Para no guardar el token en el archivo de Codex, sustituye el encabezado por
`bearer_token_env_var = "INSTANTCLIPS_TOKEN"` y expórtalo como variable de entorno en tu shell. La
aplicación de Claude acepta el token como encabezado de solicitud en el conector (los encabezados
de solicitud siguen en beta); los conectores de ChatGPT inician sesión mediante el flujo de inicio
de sesión en lugar de una clave pegada. Cualquier otro cliente envía un encabezado
`Authorization: Bearer`. El protocolo no contiene nada específico de InstantClips.

#### Clientes que solo admiten stdio y procesos sin interfaz

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

## Instrucciones para empezar

Cinco para arrancar. Sustituye el enlace o el nombre del producto.

1. «Haz un anuncio en vídeo para este producto: [URL]»
2. «Importa todos los productos de esta página de colección y prepara los planes de todos. No generes nada todavía.»
3. «Muéstrame el plan de [producto] y reescribe el gancho para que empiece por el precio.»
4. «Haz tres vídeos de [URL] con tres ganchos distintos, para que pueda probarlos.»
5. «¿A cuál de mis marcas pertenece este producto? Luego haz el vídeo.»

## Herramientas

El flujo de trabajo, en orden:

1. **Importar** — usa `import_product_from_url` para una página de tienda o
   `create_product_from_images` cuando no haya una página que leer.
2. **Esperar el borrador** — consulta `get_product` periódicamente hasta que terminen la importación
   y la preparación del plan.
3. **Revisarlo y orientarlo** — el plan se devuelve como texto: gancho, enfoque del contenido,
   formato, pautas de ejecución y restricciones. `update_video_direction` permite editarlo y
   `redraft_video_direction` propone otro enfoque.
4. **Generar** — usa `generate_video` pasando `expected_credit_cost`: el coste que se le indicó al
   usuario, tal como lo informó `get_product`. Si no coincide, se rechaza sin cobrar.
5. **Recoger el resultado** — consulta `get_video` periódicamente para obtener el MP4 terminado y
   un enlace público para compartirlo.

Otro vídeo del mismo producto sigue el mismo flujo sobre ese producto: editar o volver a preparar el
plan abre el borrador del siguiente vídeo, y `generate_video` sin borrador genera otra toma del último
plan. Un vídeo ya generado no se puede modificar. Cada respuesta de `get_product` incluye `next_step`:
qué hacer a continuación.

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

Importar un producto, preparar el plan y editarlo es **gratis**. `generate_video` es la única
herramienta que consume créditos y requiere tu autorización explícita; las herramientas indican
antes el coste, y `generate_video` recibe ese número como `expected_credit_cost`, rechazando un
lanzamiento cuyo coste haya cambiado. Un agente no puede acumular cargos sin avisarte. Consulta los
[precios](https://instantclips.ai/#pricing).

## example.py

Un cliente MCP sin dependencias: solo requiere Python 3.9 o posterior y la biblioteca estándar; no
hace falta ejecutar `pip install`. Se autentica con un token, porque un script no tiene navegador
con el que iniciar sesión.

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # todas las herramientas, con su esquema de entrada actual
python example.py call list_brands '{}' # llama a una herramienta con argumentos JSON
```

Ejecuta primero `tools`: muestra los nombres y tipos de parámetros reales de cada herramienta, que
es lo que necesitas antes de automatizar el flujo de trabajo descrito arriba.

## Enlaces

- [instantclips.ai/automate](https://instantclips.ai/automate/) — para qué sirve la
  automatización: un resultado real hecho a partir de una página de tienda, instrucciones para
  empezar, las herramientas en orden y las reglas. No repite la configuración; esa información está
  en este archivo y en la página de configuración de la aplicación.
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

Inicia sesión justo antes de publicar — el token del registro caduca en menos de una hora — y el
dominio se verifica por HTTP, no por DNS: `instantclips.ai/.well-known/mcp-registry-auth`, en el
sitio de marketing, sirve la mitad pública de esta clave (`v=MCPv1; k=ed25519; p=…`); no hay
registro TXT, así que `login dns` falla con "no MCP public key found".

```bash
mcp-publisher login http --domain instantclips.ai \
  --private-key "$(openssl pkey -in key.pem -text -noout | awk '/priv:/{f=1;next} /pub:/{f=0} f' | tr -d ' :\n')"
mcp-publisher publish
```

`test/shim.test.js` fija la versión del servidor de la instantánea y la `version` de `server.json`;
cada publicación actualiza ambas.

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
