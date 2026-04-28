# Dashboard de Riesgos - Flask

Dashboard web que lee datos de Google Sheets y muestra KPIs, gráficos y filtros interactivos.

## Estructura del Proyecto

```
dashboard_riesgos/
├── app.py              # Aplicación Flask principal
├── requirements.txt    # Dependencias Python
├── README.md          # Este archivo
├── templates/
│   └── dashboard.html # Template HTML del dashboard
└── static/
    └── dashboard.css  # Estilos adicionales
```

## Requisitos

- Python 3.8+
- pip

## Instalación

1. Crear entorno virtual (recomendado):
```bash
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
```

2. Instalar dependencias:
```bash
pip install -r requirements.txt
```

## Configuración

### URL de Google Sheets

La URL del CSV publicado está configurada en `app.py`:
```python
GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/.../pub?output=csv'
```

Para cambiarla, puedes:
1. Editar directamente `app.py`
2. Usar variable de entorno:
```bash
set GOOGLE_SHEETS_URL=https://tu-url-aqui
```

### Publicar Google Sheets

1. Abre tu Google Sheets
2. Archivo → Compartir → Publicar en la web
3. Selecciona "Valores separados por comas (.csv)"
4. Copia la URL y actualiza `app.py`

## Ejecutar

```bash
python app.py
```

El dashboard estará disponible en: http://localhost:5000

## APIs Disponibles

| Endpoint | Descripción |
|----------|-------------|
| `/` | Dashboard principal |
| `/riesgos-detalle` | Hoja HTML separada con el detalle de riesgos externos |
| `/api/datos` | Devuelve todos los KPIs y gráficos |
| `/api/riesgos-detalle` | Devuelve el detalle de riesgos externos en JSON |
| `/api/riesgos-detalle.csv` | Exporta la hoja CSV con el detalle de riesgos externos |
| `/api/actualizar` | Fuerza actualización de datos |

## Características

- ✅ KPIs: Total eventos, impacto financiero, eventos alto riesgo, etc.
- ✅ Gráfico: Eventos por mes
- ✅ Gráfico: Impacto financiero por mes
- ✅ Gráfico: Eventos por tipo de riesgo
- ✅ Gráfico: Matriz de riesgo (impacto vs probabilidad)
- ✅ Tabla: Top 10 eventos con mayor impacto
- ✅ Hoja separada: Detalle completo de riesgos externos desde Google Sheets
- ✅ Hoja CSV: Descarga filtrada del detalle de riesgos externos
- 🔄 Auto-actualización cada 5 minutos
- 💾 Cache en memoria para mejor rendimiento

## Personalización

### Agregar nuevos gráficos

1. Agregar función en `app.py`:
```python
@app.route('/api/nuevo-chart')
def nuevo_chart():
    df = fetch_data()
    # Procesar datos
    return jsonify(datos)
```

2. Agregar canvas en `dashboard.html`:
```html
<canvas id="chartNuevo"></canvas>
```

3. Agregar JavaScript en el script:
```javascript
async function renderizarChartNuevo(datos) {
    // Chart.js código
}
```

## Troubleshooting

### Error de conexión
- Verifica que la URL del CSV sea pública
- Prueba abrir la URL en el navegador

### Error de parsing
- Revisa que los nombres de columnas coincidan con los esperados
- Los campos deben ser: fecha, evento, impacto, probabilidad, tipo, plan, monto

### Datos no aparecen
- Verifica la consola del navegador (F12)
- Revisa los logs de Flask

## Próximos Pasos

- [ ] Agregar filtros por fecha
- [ ] Exportar a PDF
- [ ] Notificaciones por email
- [ ] Base de datos MySQL
- [ ] Autenticación de usuarios
