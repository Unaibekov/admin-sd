# Data Model

## Overview
В проекте нет отдельной серверной схемы. Модель данных живет в JavaScript-объектах и локальном хранилище. Ниже зафиксированы только реальные структуры, которые есть в коде.

## Batch
Карточка партии или культуры.

### Назначение
- Хранит паспорт партии, текущую стадию, количество, статус и журнал операций.

### Основные поля
- `id`
- `createdAt`
- `updatedAt`
- `cultureName`
- `speciesName`
- `varietyName`
- `name`
- `code`
- `quantity`
- `stage`
- `batchStatus`
- `status`
- `sterilityStatus`
- `qrStatus`
- `qrPrinted`
- `qrPrintedAt`
- `qrPrintedBy`
- `sourceMaterial`
- `parentBatch`
- `locationDescription`
- `startPhotoUri`
- `startPhotoUris`
- `cancelledAt`
- `cancelledBy`
- `stageChangedAt`
- `stageChangedBy`
- `stageHistory`
- `operations`
- `greenhouseCareIntervals`
- `adaptationCareIntervals`
- `hardeningCareIntervals`

### Типы
- Идентификаторы, даты и ссылки - строки.
- Количество - число или строка до нормализации.
- Флаги - boolean.
- `operations` и `stageHistory` - массивы объектов.

### Связи
- Один `Batch` содержит много `Operation`.
- Один `Batch` может содержать историю переходов стадий.
- `Batch` ссылается на `Photo` через URI и списки URI.

## Operation
Запись журнала по карточке.

### Назначение
- Фиксирует событие в день его совершения.

### Общие поля
- `id`
- `type`
- `title`
- `stage`
- `date`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`
- `comment`
- `photoUri`
- `photoUris`
- `count`
- `currentQuantity`
- `previousQuantity`
- `extraFields`

### Типовые подмножества полей
- `batchCreated`: `quantity`, `code`, `qrStatus`
- `qrGenerated`: `code`, `qrStatus`
- `stageChange`: `fromStage`, `toStage`, `stageChangedAt`, `rootedCount`, `rootingPercent`
- `introLoss`: `reason`, `lossReason`
- `sale`: `saleType`, `recipient`, `saleAmount`
- `propagation`: `propagationMethod`
- `quarantine` / `quarantineReleased`: `reason`, `quarantineReason`
- `adaptationStress`: `stressLevel`, `turgor`, `stability`, `environment*`
- `adaptationEnvironment`: `environmentTemperature`, `environmentAirHumidity`, `substrateHumidity`, `environmentLight`, `ventilation`, `humidityReduction`, `turgor`, `stability`
- `adaptationHumidityReduction`: `environmentAirHumidity`, `substrateHumidity`, `humidityReduction`, `turgor`, `stability`
- `adaptationCare`: `careType`
- `greenhouseObservation`: `growthRate`, `stressLevel`, `stability`, `riskLevel`, `conditionDescription`
- `greenhouseCare`: `careType`, `careIntervalDays`, `wateringIntervalDays`, `waterVolume`, `productName`, `dosage`, `applicationMethod`, `plantReaction`, `riskLevel`
- `greenhouseEnvironment`: `environmentTemperature`, `environmentAirHumidity`, `environmentLight`, `ventilation`, `placement`, `densityChange`, `growthRate`, `stability`, `riskLevel`
- `greenhouseDisease`: `diseaseName`, `pestName`, `diseaseSeverity`, `riskLevel`, `productName`, `dosage`, `applicationMethod`, `plantReaction`
- `hardeningObservation`: `stressLevel`, `turgor`, `readinessForPlanting`
- `hardeningCare`: `careType`, `productName`, `dosage`, `applicationMethod`, `plantReaction`
- `planting`: `plantingLocation`, `plantingScheme`, `plotArea`, `soilType`
- `plantingObservation`: `survivalRate`, `stressLevel`, `turgor`
- `plantingCare`: `careType`, `productName`, `dosage`, `applicationMethod`, `plantReaction`
- `plantingCompletion`: `completionResult`
- `movement`: `previousLocation`, `nextLocation`, `greenhouseName`, `rackName`, `shelfName`
- `problem`: `problemType`, `riskLevel`, `problemDescription`

### Связи
- Прикреплен к одной карточке.
- Может содержать один или несколько фото-URI.
- Для экспорта может получить список файлов `photoFiles`.

## Task
Служебная задача по уходу.

### Назначение
- Показать, что по карточке пора выполнить уход.

### Поля
- `id`
- `cardId`
- `cardName`
- `code`
- `locationDescription`
- `careType`
- `currentQuantity`
- `daysOverdue`
- `isOverdue`
- `isDueToday`
- `nextDate`
- `stage`
- `status`
- `title`

### Связи
- Строится из `Batch`.
- Использует расписания ухода, вычисленные по операциям и интервалам.

## Report
Экспорт для админки и внешней обработки.

### Корневые поля `report.json`
- `reportId`
- `createdAt`
- `appVersion`
- `deviceId`
- `user`
- `testLocation`
- `summary`
- `cards`

### `user`
- `userId`
- `firstName`
- `lastName`
- `displayName`
- `role`

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
Каждая запись содержит:
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
Каждая запись содержит:
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

## User
В проекте есть две реальные формы пользовательского контекста.

### Текущий пользователь
- `currentUser` из `constants.js`.
- Поля: `id`, `role`.

### Профиль сотрудника
- Загружается через quick auth.
- Поля: `firstName`, `lastName`, `displayName`, `localUserId`.

### Связи
- `currentUser` используется в логике ролей.
- Профиль сотрудника попадает в отчет как `user`.

## Photo
Отдельной сущности нет.

### Реализация
- Фото хранятся как URI.
- У карточки: `startPhotoUri`, `startPhotoUris`.
- У операции: `photoUri`, `photoUris`.
- В ZIP-экспорте фото получают имена файлов в `photos/`.

### Связи
- Фото привязаны к `Batch` и `Operation`.
- При экспорте фото переводятся в base64 и записываются в архив.

## Location
Отдельной модели локации нет.

### Реализация
- У карточки есть `locationDescription`.
- У операции `movement` есть `previousLocation`, `nextLocation`, `greenhouseName`, `rackName`, `shelfName`.
- Для отчета и списка используется вычисленное описание текущего местоположения.

### Связи
- Локация является атрибутом партии и перемещения, а не самостоятельной сущностью.
