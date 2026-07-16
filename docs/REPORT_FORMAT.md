# Report Format

## Общее
Сейчас есть два реальных формата экспорта:
- Excel-отчет.
- ZIP-отчет для будущей админки.

## Excel export

### Источник
- Формируется через `xlsx`.
- Берет карточки и журнал операций.

### Листы
- `Партии`
- `Журнал`

### Лист `Партии`
Колонки:
- Код
- Культура
- Вид
- Сорт
- Стадия
- Статус
- Местоположение
- Количество
- Дата создания
- Событий в журнале

### Лист `Журнал`
Колонки:
- Код
- Культура
- Вид
- Сорт
- Стадия партии
- Статус партии
- Дата события
- Тип события
- Стадия события
- Текущее количество
- Остаток
- Детали
- Старое место
- Новое место
- Комментарий
- Фото / заметка
- Создано

## ZIP export

### Назначение
- Перенос полной свертки данных в админку.
- Содержит `report.json` и файлы фотографий.

### Структура архива
- `report.json`
- `photos/`

### Правила упаковки фото
- Стартовые фото карточки кладутся в `photos/`.
- Фото операции кладутся в `photos/`.
- Для файлов используется безопасное имя на основе `cardId` или `eventId`.
- Расширение берется из URI, если его нельзя определить, используется `.jpg`.

## `report.json`

### Корневой объект
```json
{
  "reportId": "report-...",
  "createdAt": "2026-06-14T00:00:00.000Z",
  "appVersion": "1.0.0",
  "deviceId": "device-...",
  "user": { },
  "testLocation": "",
  "summary": { },
  "cards": []
}
```

### `summary`
- `cardsCount`
- `eventsCount`
- `photosCount`
- `problemsCount`
- `activeCount`
- `soldCount`
- `quarantineCount`
- `problemCount`
- `partialCount`
- `archivedCount`

### `cards[]`
- `cardId`
- `code`
- `cultureName`
- `speciesName`
- `varietyName`
- `stage`
- `batchStatus`
- `sterilityStatus`
- `quantity`
- `currentQuantity`
- `locationDescription`
- `createdAt`
- `updatedAt`
- `events`
- `extraFields`

### `cards[].events[]`
- `eventId`
- `type`
- `title`
- `stage`
- `date`
- `createdAt`
- `createdBy`
- `comment`
- `photoFiles`
- `problemType`
- `riskLevel`
- `count`
- `previousQuantity`
- `currentQuantity`
- `extraFields`

### `extraFields`
- Все поля, которые не входят в белый список, попадают в `extraFields`.
- Это сделано для сохранения обратной совместимости и будущего расширения.

## Совместимость
- Не менять ключи `report.json` без отдельного решения.
- Не переименовывать `photos/`.
- Не удалять поля из карточек и событий, если они уже используются админкой.
