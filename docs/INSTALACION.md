# Instalación en una VPS

Guía para dejar la web funcionando con HTTPS en tu propio servidor.

## 1. Lo que necesitas

- Una VPS con **Ubuntu 24.04**, 2 GB de RAM y 20 GB de disco (sobra para un centro).
- Un **dominio** (por ejemplo `www.posturalcentrosanitario.com`) y acceso a su DNS.
- Acceso por SSH a la VPS con un usuario con `sudo`.

## 2. Apuntar el dominio a la VPS

En el panel de tu proveedor de dominio crea estos registros con la IP pública de la VPS:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` | IP de la VPS |
| A | `www` | IP de la VPS |

Espera a que se propaguen (normalmente minutos; compruébalo con `ping www.tudominio.es`).

## 3. Preparar el servidor

```bash
sudo apt update && sudo apt upgrade -y
# Docker oficial
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # cierra la sesión SSH y vuelve a entrar

# Cortafuegos: solo SSH y web
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 4. Subir el proyecto

Con git (recomendado):

```bash
git clone https://tu-repositorio/postural-web.git ~/postural
cd ~/postural
```

O copiando el zip desde tu ordenador: `scp postural-web.zip usuario@IP:~` y después `unzip postural-web.zip -d ~/postural`.

## 5. Configurar el `.env`

```bash
cp .env.example .env
openssl rand -base64 32    # → ENCRYPTION_KEY
openssl rand -base64 24    # → POSTGRES_PASSWORD (y ponla también en DATABASE_URL)
nano .env
```

Ejemplos de dominio:

| Caso | `DOMAIN` | `ALIAS_DOMAINS` | `PUBLIC_BASE_URL` |
|---|---|---|---|
| Web del centro | `www.posturalcentrosanitario.com` | `posturalcentrosanitario.com` | `https://www.posturalcentrosanitario.com` |
| Demo en un subdominio tuyo | `postural.tudominio.es` | *(vacío)* | `https://postural.tudominio.es` |

Para la demo en un subdominio, en el DNS basta un registro **A** con nombre `postural` apuntando a la IP de la VPS.

Rellena como mínimo `DOMAIN`, `ACME_EMAIL`, `PUBLIC_BASE_URL`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD` y `DATABASE_URL`. Google y WhatsApp se pueden dejar para después: la web funciona sin ellos.

> **Guarda una copia de `ENCRYPTION_KEY` en un sitio seguro.** Si se pierde, habrá que volver a conectar las cuentas de Google, y los enlaces para gestionar citas ya enviados dejarán de aparecer en los recordatorios.

## 6. Arrancar

```bash
docker compose up -d --build
docker compose ps          # db, app, worker y web en «running»; migrate en «exited (0)»
docker compose logs -f app # Ctrl+C para salir
```

Caddy obtiene el certificado HTTPS automáticamente la primera vez. Abre `https://www.tudominio.es`.

## 7. Crear el usuario del panel

```bash
docker compose run --rm app node server/src/scripts/create-admin.ts recepcion@tudominio.es "Recepción" admin
```

Te pedirá la contraseña (mínimo 12 caracteres). Para un usuario que no pueda cambiar la configuración ni los especialistas, usa `staff` en lugar de `admin`.

Entra en `https://www.tudominio.es/admin/`.

## 8. Primeros pasos en el panel

1. **Especialistas → Añadir especialista:** nombre, foto, especialidad, servicios, horario semanal, pausas, duración de franja y vacaciones.
2. **Horarios y disponibilidad:** revisa que el horario de clases y el aforo sigan vigentes.
3. **Servicios:** revisa duraciones y descripciones.
4. **Configuración:** datos del centro, antelación mínima, plazo para cancelar online y recordatorios.
5. Conecta [Google Calendar](GOOGLE_CALENDAR.md) y [WhatsApp](WHATSAPP.md).

## 9. Copias de seguridad

```bash
chmod +x scripts/backup.sh
crontab -e
# añade esta línea (copia diaria a las 3:30; guarda 14 días):
30 3 * * * /home/USUARIO/postural/scripts/backup.sh >> /home/USUARIO/postural/backups/backup.log 2>&1
```

Conviene copiar también la carpeta `backups/` fuera del servidor (por ejemplo, con `rclone` a un almacenamiento externo).

Para restaurar una copia:

```bash
gunzip -c backups/postural-AAAAMMDD-HHMM.sql.gz | docker compose exec -T db psql -U postural -d postural
```

## 10. Mantenimiento

| Qué | Comando |
|---|---|
| Ver registros | `docker compose logs -f app worker` |
| Reiniciar | `docker compose restart app worker` |
| Parar todo | `docker compose down` (los datos se conservan) |
| Estado de la API | `curl https://www.tudominio.es/api/health` |
| Entrar en la base de datos | `docker compose exec db psql -U postural -d postural` |

Ejecuta **un solo worker**. Si hubiera dos, no se duplicarían los mensajes (las tareas se reservan con `FOR UPDATE SKIP LOCKED`), pero no hace falta.
