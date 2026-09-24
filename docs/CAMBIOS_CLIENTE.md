# Cambios a aplicar en la app Flutter (VigiaApp)

Guía para llevar la app (`/home/jota/Documentos/Desarrollo/VigiaApp`) del contrato **v1.0**
(`docs/especificacion_api_db.md`) a la API real **v1.1** de este repo. El contrato completo, con
esquemas y ejemplos, está en [`openapi.yaml`](openapi.yaml). Se puede abrir en
<https://editor.swagger.io> o con la extensión *OpenAPI* de VS Code.

> **Lo que ya existe sigue funcionando igual.** Las 8 rutas que la app consume hoy mantienen URL,
> método, body y JSON de respuesta. La API solo **agrega** campos (que `fromJson` ignora) y rutas nuevas.
> El único cambio que rompe compatibilidad es la autenticación: v1.0 usaba SMS y v1.1 usa email y contraseña.

---

## 1. Resumen: spec v1.0 → API v1.1

| Tema | v1.0 (spec) | v1.1 (API real) | Impacto en la app |
|---|---|---|---|
| Backend | PHP 8 + PDO | Node 22/24 + Express 5 + Drizzle, desplegado como Node.js Web App en Hostinger | Ninguno |
| URL base | `https://<dominio>/api/v1` | Igual | Ninguno |
| Login | `POST /auth/codigo` + `POST /auth/verificar` (SMS de 4 dígitos) | Invitación por email → `POST /auth/clave`; después `POST /auth/login` con email y contraseña | **Nuevo flujo y pantallas** (§3) |
| JSON de sesión | `{token, expira_en, vecino:{id,nombre,manzana,rol}}` | **Igual** | Se reutiliza el modelo |
| Sesión | Bearer de 24 h | Igual. Se suman `POST /auth/logout`, `GET /yo` y `POST /yo/clave` | Guardar el token y validarlo al abrir la app |
| Recuperar acceso | — | `POST /auth/recuperar` → email con enlace → `POST /auth/clave` | Pantalla "olvidé mi contraseña" |
| Errores | 400, 401, 404, 409, 429, 500 | Se suma **403 `prohibido`** (acción solo del comité o del autor) | Mostrar `mensaje` |
| `GET /publicaciones` | — | Agrega `tipo`, `autor_id` y `etiqueta` (null en actividad) | Opcional: `autor_id` para mostrar "borrar" |
| Noticias | `etiqueta` puede faltar | `etiqueta` es **obligatoria** en noticias (lo garantiza la base) | Ninguno (`NewsItem` ya la exige) |
| `GET /alertas/{id}` | 5 campos | Agrega `mi_respuesta`, `lat`, `lng`, `creada_en`, `cerrada_en` y `vecino{id,nombre,manzana}` | Opcional (§4.4) |
| `POST /alertas` | Siempre 201 | 201 si es nueva. **200** con la misma alerta si el vecino ya tenía una activa | Ninguno (la app lee `id`) |
| Alertas: resto del ciclo | `central_911_confirmada` y `en_camino` sin forma de cambiarlos | `GET /alertas`, `POST /alertas/{id}/en-camino`, `/confirmar-911` (comité) y `/resolver` | **Nuevas pantallas y acciones** (§5) |
| Rondines | Solo ver y responder | + `POST /rondines`, `GET`/`PUT /rondines/{id}/asignaciones`, `DELETE /rondines/{id}` (comité). "No me presento" le manda un email al comité | Panel del comité (§6) |
| Publicar | — | `POST /publicaciones`, `DELETE /publicaciones/{id}`, `GET`/`POST /publicaciones/{id}/respuestas` | Publicar y responder (§7) |
| Vecinos | — | `GET /manzanas`, `POST /manzanas`, `GET /vecinos`, `POST /vecinos`, `PATCH /vecinos/{id}`, `POST /vecinos/{id}/invitacion` (comité) | Panel del comité (§6) |
| Tablas | `codigos_otp`, `publicaciones.respuestas` | `tokens_clave`, contador calculado y `publicacion_respuestas` nueva | Ninguno (ver `BASE_DE_DATOS.md`) |

---

## 2. Conectar la app a la API

`lib/main.dart`:

```dart
import 'services/http_vigia_api.dart';

MyApp({super.key, VigiaApi? api})
    : api = api ?? HttpVigiaApi('https://<dominio>/api/v1');
```

Para desarrollo local, con la API corriendo en tu máquina (`npm run dev`):
- Emulador Android: `HttpVigiaApi('http://10.0.2.2:3000/api/v1')`.
- Dispositivo físico: la IP de la PC en la LAN, por ejemplo `http://192.168.0.10:3000/api/v1`.
- Android bloquea HTTP sin cifrar por defecto. Para desarrollo hay que agregar `android:usesCleartextTraffic="true"` en el `<application>` de un manifest de **debug** (`android/app/src/debug/AndroidManifest.xml`), nunca en el de release.
- Usuarios del seed: `maria@vigia.test` (vigía), `laura@vigia.test` (comité), `jorge@vigia.test`, etc. Contraseña: `vigia1234`.

Esto reemplaza el "token de prueba" del §5.5 de la spec: ahora se obtiene uno real con `login`.

---

## 3. Sesión (reemplaza RF-09)

### 3.1 Flujo

```
Comité: POST /vecinos ──► email "Te invitaron a VigiaApp"
                              │  enlace: <APP_URL_CLAVE>?token=<64 hex>
                              ▼
Vecino abre el enlace ──► pantalla "Elegí tu contraseña" ──► POST /auth/clave {token, password}
                                                                  │ 200 = sesión (ya queda logueado)
Días después (token vencido, 401) ──► pantalla Login ──► POST /auth/login {email, password}
Olvidó la clave ──► POST /auth/recuperar {email} ──► email ──► mismo "Elegí tu contraseña"
```

- **`APP_URL_CLAVE`** se configura en el servidor: `https://<dominio>/clave`. Gmail y otros clientes no dejan tocar `vigiaapp://`, así que el correo lleva ese https y la API responde una página con el botón "Abrir VigiaApp" (`vigiaapp://clave?token=…`) y el código para pegar a mano. Cómo recibe la app el deep link:
  - **Deep link** `vigiaapp://clave` (lo más simple). Android necesita un `intent-filter` (§3.4) y la app lee el enlace con el paquete [`app_links`](https://pub.dev/packages/app_links).
  - **App Link HTTPS** (`https://<dominio>/clave`). Funciona también en el navegador, pero requiere publicar `assetlinks.json` en el dominio.
  - Mientras no haya deep link, la pantalla "Elegí tu contraseña" puede aceptar que el vecino **pegue el enlace o el token** del correo: `Uri.parse(texto).queryParameters['token'] ?? texto`.
- La contraseña va de 8 a 128 caracteres (si no, la API responde 400 con el mensaje para mostrar).
- `/auth/*` admite 20 pedidos cada 15 minutos por IP. Si se pasa, responde 429 `demasiados_intentos`.

### 3.2 Modelos nuevos: `lib/models/sesion.dart`

```dart
class Sesion {
  Sesion({required this.token, required this.expiraEn, required this.vecino});

  factory Sesion.fromJson(Map<String, dynamic> json) => Sesion(
        token: json['token'] as String,
        expiraEn: DateTime.parse(json['expira_en'] as String),
        vecino: VecinoSesion.fromJson(json['vecino'] as Map<String, dynamic>),
      );

  final String token;
  final DateTime expiraEn;
  final VecinoSesion vecino;
}

class VecinoSesion {
  VecinoSesion({required this.id, required this.nombre, required this.manzana, required this.rol});

  factory VecinoSesion.fromJson(Map<String, dynamic> json) => VecinoSesion(
        id: json['id'] as int,
        nombre: json['nombre'] as String, // "María Ríos"
        manzana: json['manzana'] as String,
        rol: json['rol'] as String, // 'vecino' | 'vigia' | 'comite'
      );

  final int id;
  final String nombre;
  final String manzana;
  final String rol;

  bool get esComite => rol == 'comite';
}

/// GET /yo
class Perfil {
  Perfil({required this.id, required this.nombre, required this.apellido, required this.email,
      this.telefono, required this.manzanaId, required this.manzana, required this.rol});

  factory Perfil.fromJson(Map<String, dynamic> json) => Perfil(
        id: json['id'] as int,
        nombre: json['nombre'] as String,
        apellido: json['apellido'] as String,
        email: json['email'] as String,
        telefono: json['telefono'] as String?,
        manzanaId: json['manzana_id'] as int,
        manzana: json['manzana'] as String,
        rol: json['rol'] as String,
      );

  final int id;
  final String nombre, apellido, email, manzana, rol;
  final String? telefono;
  final int manzanaId;
}
```

### 3.3 Guardar el token

- Guardarlo con [`flutter_secure_storage`](https://pub.dev/packages/flutter_secure_storage), no en `shared_preferences`: el token da acceso a la cuenta.
- Al abrir la app: si hay un token guardado, `api.token = guardado` y llamar a `GET /yo`. Si responde 200, ir al inicio. Si responde 401, borrar el token e ir al login.
- **Cualquier 401 en cualquier pantalla** significa que la sesión venció (24 h) o se cerró (recuperación de clave, cambio de clave, vecino desactivado). La respuesta es borrar el token y volver al login. Conviene centralizarlo con un callback en `HttpVigiaApi` (§4.2).
- `POST /yo/clave` responde **400** (no 401) si la contraseña actual es incorrecta, para no cerrar la sesión.

### 3.4 Deep link en Android (si se usa `vigiaapp://clave`)

`android/app/src/main/AndroidManifest.xml`, dentro de la `<activity>` principal:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="vigiaapp" android:host="clave" />
</intent-filter>
```

---

## 4. Servicios

### 4.1 `lib/services/vigia_api.dart`: métodos nuevos del contrato

```dart
  // ---- Sesión ----
  /// POST /auth/login
  Future<Sesion> login(String email, String password);
  /// POST /auth/clave: activar la invitación o restablecer la clave.
  Future<Sesion> elegirClave(String token, String password);
  /// POST /auth/recuperar (siempre OK, exista o no el email)
  Future<void> recuperarClave(String email);
  /// POST /auth/logout
  Future<void> logout();
  /// GET /yo
  Future<Perfil> obtenerPerfil();
  /// POST /yo/clave
  Future<void> cambiarClave(String actual, String nueva);

  // ---- Alertas ----
  /// GET /alertas?estado=activa: polling del inicio para enterarse de un SOS.
  Future<List<EstadoAlerta>> obtenerAlertas({String estado = 'activa'});
  /// POST /alertas/{id}/en-camino
  Future<EstadoAlerta> marcarEnCamino(int alertaId, {bool enCamino = true});
  /// POST /alertas/{id}/resolver (quien la disparó o el comité)
  Future<void> resolverAlerta(int alertaId);
  /// POST /alertas/{id}/confirmar-911 (comité)
  Future<EstadoAlerta> confirmar911(int alertaId);

  // ---- Publicaciones ----
  /// POST /publicaciones (tipo 'actividad'; 'noticia' requiere etiqueta y rol comité)
  Future<void> publicar({required String tipo, required String titulo, String? cuerpo, String? etiqueta, String? firma});
  /// DELETE /publicaciones/{id}
  Future<void> borrarPublicacion(int id);
  /// GET /publicaciones/{id}/respuestas
  Future<List<RespuestaPublicacion>> obtenerRespuestas(int publicacionId);
  /// POST /publicaciones/{id}/respuestas
  Future<RespuestaPublicacion> responder(int publicacionId, String texto);

  // ---- Comité ----
  Future<List<Manzana>> obtenerManzanas();                                  // GET /manzanas
  Future<List<VecinoAdmin>> obtenerVecinos();                               // GET /vecinos
  Future<VecinoAdmin> crearVecino({required String nombre, required String apellido,
      required String email, String? telefono, required int manzanaId, String rol = 'vecino'}); // POST /vecinos
  Future<VecinoAdmin> editarVecino(int id, Map<String, dynamic> cambios);   // PATCH /vecinos/{id}
  Future<void> reenviarInvitacion(int vecinoId);                            // POST /vecinos/{id}/invitacion
  Future<PatrolShift> crearTurno({required DateTime fecha, required String ruta,
      String? horaInicio, String? horaFin, List<int> vecinoIds = const []}); // POST /rondines
  Future<List<Asignacion>> obtenerAsignaciones(int turnoId);                // GET /rondines/{id}/asignaciones
  Future<List<Asignacion>> reasignarTurno(int turnoId, List<int> vecinoIds); // PUT /rondines/{id}/asignaciones
  Future<void> borrarTurno(int turnoId);                                    // DELETE /rondines/{id}
```

> Si la interfaz queda muy grande, los métodos del comité pueden ir en una `ComiteApi` aparte.
> No hace falta para que funcione.

### 4.2 `lib/services/http_vigia_api.dart`

1. **Helpers que faltan.** Hoy solo hay `_get` y `_post`. Hay que sumar `_put`, `_patch` y `_delete` con la misma forma que `_post` (`_cliente.put/patch/delete` + `.timeout(_timeout)` + `_procesar`). Las respuestas **204** llegan con cuerpo vacío y `_procesar` ya devuelve `null` en ese caso.
2. **Token.** `login` y `elegirClave` guardan `token = sesion.token`. `logout` lo pone en `null` (aunque el POST falle).
3. **401 centralizado.** Un callback opcional que la app usa para volver al login:
   ```dart
   HttpVigiaApi(this.baseUrl, {this.token, this.onSesionVencida, http.Client? cliente}) ...
   final void Function()? onSesionVencida;

   // en _procesar, antes del throw:
   if (respuesta.statusCode == 401 && token != null) {
     token = null;
     onSesionVencida?.call();
   }
   ```
   La condición `token != null` evita disparar el callback por un login con clave incorrecta.
4. **Implementaciones.** Un ejemplo por tipo de ruta; el resto sigue el mismo patrón:
   ```dart
   @override
   Future<Sesion> login(String email, String password) async {
     final sesion = Sesion.fromJson(await _post('/auth/login', {'email': email, 'password': password}));
     token = sesion.token;
     return sesion;
   }

   @override
   Future<List<EstadoAlerta>> obtenerAlertas({String estado = 'activa'}) async {
     final lista = await _get('/alertas', {'estado': estado}) as List;
     return [for (final json in lista) EstadoAlerta.fromJson(json)];
   }

   @override
   Future<EstadoAlerta> marcarEnCamino(int alertaId, {bool enCamino = true}) async =>
       EstadoAlerta.fromJson(await _post('/alertas/$alertaId/en-camino', {'en_camino': enCamino}));

   @override
   Future<PatrolShift> crearTurno({required DateTime fecha, required String ruta,
       String? horaInicio, String? horaFin, List<int> vecinoIds = const []}) async {
     return PatrolShift.fromJson(await _post('/rondines', {
       'fecha': fecha.toIso8601String().substring(0, 10), // AAAA-MM-DD
       'ruta': ruta,
       'hora_inicio': ?horaInicio,
       'hora_fin': ?horaFin,
       'vecino_ids': vecinoIds,
     }));
   }

   @override
   Future<List<Asignacion>> reasignarTurno(int turnoId, List<int> vecinoIds) async {
     final lista = await _put('/rondines/$turnoId/asignaciones', {'vecino_ids': vecinoIds}) as List;
     return [for (final json in lista) Asignacion.fromJson(json)];
   }
   ```

### 4.3 `lib/services/fake_vigia_api.dart`

Implementar los mismos métodos en memoria para que la app siga andando sin servidor y los tests de
widgets no dependan de la red. Conviene que el fake responda **lo mismo que la API** en los casos borde:
- `login` con clave incorrecta: `ApiException(codigo: 401)`.
- `marcarEnCamino` sobre una alerta cancelada: 409.
- Un vecino que no es del comité llamando a métodos del comité: 403.

### 4.4 Modelos: cambios y nuevos

**`lib/models/alerta.dart`.** `EstadoAlerta` sigue leyendo los mismos 5 campos. Se le pueden sumar como opcionales, así el fake actual sigue compilando:
```dart
      miRespuesta: json['mi_respuesta'] as String?,        // 'notificado' | 'en_camino' | null
      creadaEn: json['creada_en'] == null ? null : DateTime.parse(json['creada_en'] as String).toLocal(),
      vecinoNombre: (json['vecino'] as Map<String, dynamic>?)?['nombre'] as String?,
      manzana: (json['vecino'] as Map<String, dynamic>?)?['manzana'] as String?,
      lat: (json['lat'] as num?)?.toDouble(),
      lng: (json['lng'] as num?)?.toDouble(),
```
El mismo modelo sirve para `GET /alertas` (lista) y para las respuestas de `en-camino` y `confirmar-911`.

**`lib/models/feed.dart`.** A `ActivityItem` se le puede sumar `autorId: json['autor_id'] as int?`, para mostrar "borrar" solo en las publicaciones propias.

**Nuevos** (mismo estilo que los actuales, con `factory fromJson`):

| Clase | JSON | Ruta |
|---|---|---|
| `Manzana` | `{id, nombre}` | `GET /manzanas` |
| `VecinoAdmin` | `Perfil` + `{activo, invitacion_pendiente, ultimo_acceso}` (+ `invitacion_enviada` al crear) | `GET/POST/PATCH /vecinos` |
| `RespuestaPublicacion` | `{id, texto, autor, iniciales, autor_id, creado_en}` | `/publicaciones/{id}/respuestas` |
| `Asignacion` | `{vecino_id, nombre, estado, respondido_en}` | `/rondines/{id}/asignaciones` |

`PatrolShift`, `NewsItem` y `EstadoBarrio` **no cambian**.

---

## 5. Alertas: pantallas y comportamiento

- **Inicio (`home_screen.dart`).** Hacer polling de `obtenerAlertas()` cada ~10 s mientras la pantalla está visible (cancelar el `Timer` en `dispose`, como ya hace `active_alert_screen.dart`). Si hay alertas de otros (`alerta.vecino.id != yo` o `miRespuesta != null`), mostrar un banner rojo con quién y qué manzana, y un botón **"Voy en camino"**.
- **Alerta ajena.** Una pantalla parecida a `active_alert_screen.dart` que:
  - consulta `GET /alertas/{id}` cada 2 s;
  - muestra el contador `en_camino`;
  - ofrece "Voy en camino" / "Ya no voy" (`marcarEnCamino(id, enCamino: ...)`);
  - si el vecino es del comité, ofrece además "Confirmar 911" y "Resolver".
- **Alerta propia (`active_alert_screen.dart`).** Queda como está (cancelar = falsa alarma). Se puede sumar "Resolver" (la emergencia terminó) con `resolverAlerta`.
- **Cerrar el polling.** Cuando `estado != 'activa'`, dejar de consultar y mostrar el cierre (409 en cualquier acción = la alerta ya se cerró).
- **Doble SOS.** `POST /alertas` devuelve la misma alerta si ya había una activa, así que un doble toque no duplica avisos. La app no tiene que hacer nada.

## 6. Panel del comité (solo si `vecino.rol == 'comite'`)

- **Vecinos.**
  - Lista con `GET /vecinos`: marcar "invitación pendiente" y "inactivo".
  - Alta con `POST /vecinos`: el selector de manzana sale de `GET /manzanas`. Si la respuesta trae `invitacion_enviada: false`, avisar y ofrecer "Reenviar invitación".
  - Edición y baja lógica con `PATCH /vecinos/{id}` (`activo: false`). El comité no puede cambiarse su propio rol ni desactivarse (409).
- **Rondines.**
  - Crear un turno por fecha con `POST /rondines`: 409 si la fecha ya tiene turno.
  - Ver quién respondió con `GET /rondines/{id}/asignaciones`.
  - Reasignar con `PUT /rondines/{id}/asignaciones`: quien sigue asignado conserva su respuesta.
  - Borrar con `DELETE /rondines/{id}`.
  - Cuando un vecino responde "No me presento", el comité recibe un **email**. En la app se ve como `estado: 'ausente'` en las asignaciones.
- **Noticias.** `publicar(tipo: 'noticia', etiqueta: ..., firma: 'Comité', ...)`.

## 7. Publicaciones

- Botón "Publicar" en el feed de actividad: `publicar(tipo: 'actividad', titulo: ...)`.
- Al tocar una publicación: `GET /publicaciones/{id}` (trae `cuerpo`) y la lista de respuestas, con un campo para responder.
- "Borrar" solo si `autorId == yo` o si el vecino es del comité (si no, la API responde 403).

---

## 8. Tests a sumar en `test/api_test.dart`

Mismo patrón `MockClient` que los actuales:
1. `login` hace `POST /auth/login` con `{email, password}`, parsea `Sesion` y deja el `token` puesto en el header de la siguiente llamada.
2. Un 401 con token cargado llama a `onSesionVencida` y limpia el token. Un 401 en `login` no lo llama.
3. `marcarEnCamino` manda `{"en_camino": true}` a `/alertas/7/en-camino`.
4. `obtenerAlertas` arma `?estado=activa` y parsea la lista con los campos nuevos (`mi_respuesta`, `vecino`).
5. `reasignarTurno` usa **PUT** y `borrarPublicacion` usa **DELETE**, y ambos aceptan el 204 sin cuerpo.
6. `EstadoAlerta.fromJson` sigue funcionando con el JSON viejo de 5 campos (compatibilidad con el fake).

La API tiene su propia suite de integración (`npm test` en este repo), que verifica los mismos contratos contra una base real.

---

## 9. Secciones de `docs/especificacion_api_db.md` a actualizar

| Sección | Qué cambiar |
|---|---|
| Encabezado | Versión 1.1: "API implementada en Express; contrato en `vigia_api/docs/openapi.yaml`" |
| §1 Alcance | "Backend sugerido: PHP" → Node.js 22/24 + Express 5 + Drizzle (Node.js Web App de Hostinger, plan Business o Cloud). "Credenciales fuera de `public_html`" → variables de entorno en hPanel. Diagrama: `index.php` → `Express (dist/src/index.js)` |
| §2.1 RF-09 | "Ingresar con teléfono y código SMS" → "Ingresar con email y contraseña; alta por invitación del comité". Sumar RF-10…: alertas activas, en camino, 911, resolver; gestión de vecinos y rondines; publicar y responder |
| §2.2 RNF | RNF-01 sigue. Sumar: 403 `prohibido`; límite de 20 pedidos a `/auth` cada 15 minutos por IP |
| §3.1 | Sumar la fila `403 prohibido` |
| §3.2 | Reemplazar por el flujo del §3 de este documento (`/auth/login`, `/auth/clave`, `/auth/recuperar`, `/auth/logout`, `/yo`) |
| §3.3 a §3.6 | Sumar los campos nuevos (§1 de este documento) y las rutas nuevas, o remitir a `openapi.yaml` |
| §4 | Reemplazar por `vigia_api/docs/BASE_DE_DATOS.md` (el DDL vive en `vigia_api/drizzle/`) |
| §4.4 | Borrar (era la conexión PDO). La conexión está en `vigia_api/src/db/index.ts` |
| §5 | Pasos del §2 de este documento. Ya no hace falta un "token de prueba": se usa el login del seed |
