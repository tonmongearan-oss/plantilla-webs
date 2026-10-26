# Actualizar la web

## Cambios que se hacen desde el panel (sin tocar código)

- Especialistas: alta, foto, biografía, servicios, horario, pausas, vacaciones, calendario de Google.
- Servicios: nombre, descripción, duración, precio orientativo, quién los ofrece, activar o desactivar.
- Clases: horario semanal, modalidad y aforo.
- Datos del centro (teléfono, correo, dirección, horario de atención), reglas de reserva y recordatorios.

Todo se aplica al momento en la web.

## Cambiar textos o imágenes de las páginas

- Las páginas están en `web/src/pages/*.html`. La cabecera, el menú y el pie, en `web/src/partials/`.
- Las imágenes van en `web/public/assets/img/`. Usa `.webp` o `.jpg` de 1600 px de ancho como máximo.
- Los estilos están en `web/public/assets/css/` (los colores de marca, al principio de `_base.css`).

Para comprobarlo en tu ordenador: `npm run build:web` y `npm run dev`, y abre <http://localhost:3000>.

Publicar en la VPS:

```bash
cd ~/postural
git pull                       # o sube los ficheros cambiados
docker compose up -d --build web
```

## Actualizar el código (API, worker o panel)

```bash
cd ~/postural
./scripts/backup.sh            # copia de seguridad antes de actualizar
git pull
docker compose up -d --build
docker compose logs -f app worker
```

Las migraciones de la base de datos se aplican solas al arrancar (servicio `migrate`).

### Añadir una migración

Crea un fichero nuevo en `server/migrations/` con un número mayor, por ejemplo `002_notas_internas.sql`. Cada fichero se aplica una sola vez, dentro de una transacción. **No modifiques migraciones que ya estén aplicadas.**

### Volver a la versión anterior

```bash
git log --oneline              # localiza la versión buena
git checkout <commit>
docker compose up -d --build
```

Si la actualización incluía una migración que hay que deshacer, restaura la copia de seguridad (ver docs/INSTALACION.md).

## Antes de subir cambios de código

```bash
npm install
npm run typecheck              # comprobación de tipos de TypeScript
TEST_DATABASE_URL=… npm test   # pruebas automáticas
```

## Actualizar Node, PostgreSQL o Caddy

- **Node y Caddy:** `docker compose build --pull && docker compose up -d`.
- **PostgreSQL:** para cambiar de versión mayor (por ejemplo, de 16 a 17) hay que exportar y restaurar:
  1. Haz una copia con `scripts/backup.sh`.
  2. Cambia la imagen en `docker-compose.yml`.
  3. Borra el volumen `pgdata`.
  4. Arranca y restaura la copia.
