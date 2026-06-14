# Админка Sadovnik Diary

Временная локальная веб-админка для просмотра ZIP-экспортов из MVP Sadovnik Diary.

## Что делает

- Принимает вручную загруженный `report.zip`
- Проверяет архив
- Извлекает `report.json` и `photos/`
- Сохраняет все на диск
- Показывает HTML-отчет с фильтрами, миниатюрами и полноэкранным просмотром

## Стек

- Node.js
- Express
- EJS
- Multer
- unzipper
- Только файловое хранение

Без React, Next.js, NestJS, Docker, Redis, PostgreSQL и MongoDB.

## Локальный запуск

```bash
npm install
npm start
```

Затем откройте:

```text
http://localhost:3000
```

## Структура папок

```text
data/
  reports/
    {reportId}/
      report.json
      summary.json
      photos/
      original.zip

examples/
  report.json
  report.zip
  photos/

public/
views/
src/
server.js
```

## Формат архива

Загружаемый ZIP должен содержать:

```text
report.json
photos/
```

Если `report.json` отсутствует, импорт отклоняется.

## report.json

Минимальная структура:

```json
{
  "reportId": "string",
  "createdAt": "2026-06-14T10:00:00.000Z",
  "deviceId": "string",
  "user": {
    "userId": "string",
    "firstName": "string",
    "lastName": "string",
    "displayName": "string",
    "role": "string"
  },
  "testLocation": "string",
  "summary": {
    "cardsCount": 0,
    "eventsCount": 0,
    "photosCount": 0,
    "problemsCount": 0,
    "activeCount": 0,
    "soldCount": 0
  },
  "cards": []
}
```

Рендерер специально сделан терпимым: дополнительные поля в карточках и событиях сохраняются и показываются в интерфейсе.

## Маршруты

- `GET /` - список отчетов
- `GET /upload` - форма загрузки
- `POST /upload` - импорт ZIP
- `GET /reports/:reportId` - просмотр отчета
- `GET /reports/:reportId/raw` - скачать `report.json`
- `GET /reports/:reportId/zip` - скачать исходный ZIP

## Безопасность

- Проверка расширения ZIP
- Ограничение размера файла
- Проверка наличия `report.json`
- Защита от path traversal при распаковке

## Дальнейшее развитие

- SQLite persistence
- Авторизация
- Автоимпорт из мобильного приложения
- AI-анализ отчетов

Это намеренно не реализовано в данном MVP.
