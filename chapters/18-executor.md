# Executor: задача отдельно от потока

> Пакет, история появления и пулы потоков

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →

## В каком пакете находится Executor

`Executor` — интерфейс стандартной библиотеки Java из пакета `java.util.concurrent`:

```java
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
```

Название пакета можно прочитать как «утилиты для конкурентного программирования»:

```text
java
└── util
    └── concurrent
        ├── Executor
        ├── ExecutorService
        ├── Executors
        ├── Future
        ├── Callable
        └── ThreadPoolExecutor
```

`Executor`, `ExecutorService`, `Executors` и `ThreadPoolExecutor` — разные сущности. Похожие названия легко перепутать, поэтому сначала построим карту API.

## Когда и зачем он появился

Executor Framework (фреймворк исполнителей) вошёл в **Java 5 в 2004 году** как часть [JSR 166: Concurrency Utilities](https://jcp.org/aboutJava/communityprocess/final/jsr166/index.html). Руководителем JSR 166 был Doug Lea. Вместе с executors в стандартной библиотеке появилось большое семейство согласованных concurrency-инструментов: concurrent collections, blocking queues, locks, atomics и synchronizers.

До появления общего API разработчики часто напрямую создавали потоки или писали собственные очереди и пулы. В таком коде смешивались разные обязанности:

```java
new Thread(downloadTask).start();
```

Одна строка одновременно определяет:

- задачу `downloadTask`;
- политику «создать новый поток»;
- момент запуска;
- способ расходования системных ресурсов.

Если приложение получает тысячу ссылок и для каждой создаёт `new Thread(...)`, оно может породить тысячу platform threads (платформенных потоков). Каждый поток требует stack и других ресурсов операционной системы. Большое число потоков расходует память и увеличивает стоимость переключения контекста.

Стандартный Executor API появился, чтобы отделить **предоставление задачи** от **политики её выполнения**. Официальное описание Java формулирует ту же идею: интерфейс отделяет отправку задачи от механики использования потоков и планирования. [Документация `Executor`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/Executor.html)

## Базовый интерфейс Executor

У интерфейса всего один основной метод:

```java
public interface Executor {
    void execute(Runnable command);
}
```

Использование:

```java
Executor executor = obtainExecutor();
executor.execute(downloadTask);
```

Задача сообщает, **что выполнить**. Конкретный executor определяет, **как выполнить**:

- сразу в вызывающем потоке;
- в новом потоке;
- в одном фоновом потоке;
- в пуле из нескольких worker threads (рабочих потоков);
- позже, после ожидания в очереди.

Важная деталь: сам интерфейс `Executor` не обещает асинхронное выполнение и не означает «пул потоков». Например, допустима такая реализация:

```java
Executor directExecutor = command -> command.run();
```

Она выполняет задачу прямо в вызывающем потоке. Политику задаёт реализация, а не интерфейс.

## Карта связанных типов

```text
Runnable / Callable
        задача
          ↓
Executor
        только execute(Runnable)
          ↓ extends
ExecutorService
        submit, Future, shutdown
          ↓ implements
ThreadPoolExecutor
        реальный настраиваемый пул

Executors
        фабричные методы для создания готовых ExecutorService
```

### Executor

Минимальный контракт для отправки `Runnable`. Не предоставляет результата и методов завершения.

### ExecutorService

**Executor service (сервис выполнения задач)** расширяет `Executor` и добавляет:

- `submit()` — отправить задачу и получить `Future`;
- `shutdown()` и `shutdownNow()` — управлять завершением;
- `invokeAll()` и `invokeAny()` — работать с группами задач;
- методы проверки состояния сервиса.

### Executors

`Executors` — не executor и не интерфейс. Это utility class (служебный класс) со статическими фабричными методами:

```java
Executors.newFixedThreadPool(4);
Executors.newSingleThreadExecutor();
Executors.newScheduledThreadPool(2);
```

### ThreadPoolExecutor

`ThreadPoolExecutor` — конкретная настраиваемая реализация пула. В OpenJDK именно такой объект создаёт `newFixedThreadPool()`, но контракт фабричного метода возвращает его через интерфейс `ExecutorService`. Прикладному коду обычно важен интерфейс, а не конкретный класс реализации.

### Future

`Future<T>` (будущий результат) — объект, через который можно:

- дождаться результата с помощью `get()`;
- проверить завершение через `isDone()`;
- попытаться отменить задачу через `cancel()`;
- проверить отмену через `isCancelled()`.

## Зачем Executor менеджеру загрузок

Менеджер получает много независимых задач скачивания. Ему нужны четыре свойства:

1. Не создавать отдельный поток для каждой ссылки.
2. Ограничить число одновременно работающих загрузок.
3. Сохранить остальные задачи в очереди.
4. Получить объект для ожидания и отмены каждой задачи.

Под эти требования подходит фиксированный пул:

```java
ExecutorService executor =
    Executors.newFixedThreadPool(4);
```

Число `4` означает: одновременно задачи выполняют не более четырёх worker threads. Если все они заняты, новая задача ждёт во внутренней очереди.

```text
downloadTask 1 ─→ worker 1
downloadTask 2 ─→ worker 2
downloadTask 3 ─→ worker 3
downloadTask 4 ─→ worker 4
downloadTask 5 ─┐
downloadTask 6 ─┼→ очередь ожидания
downloadTask 7 ─┘
```

Пул ограничивает число потоков, но важно понимать другую границу: `newFixedThreadPool()` использует очередь без фиксированной ёмкости. Он не создаст тысячу worker threads, однако очень большой поток входящих задач может заполнить память очередью. Ограниченные очереди и backpressure (обратное давление) разбираются отдельно.

## Полный пример с импортами

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

ExecutorService executor =
    Executors.newFixedThreadPool(4);

Future<Download> future =
    executor.submit(downloadTask);
```

Разберём выражения по очереди:

```text
Executors
    фабрика

newFixedThreadPool(4)
    создаёт фиксированный пул из четырёх workers

ExecutorService executor
    переменная хранит пул через его интерфейс

submit(downloadTask)
    передаёт задачу пулу

Future<Download>
    позволяет получить результат или отменить задачу
```

Чтобы `submit()` вернул `Future<Download>`, `downloadTask` должна быть `Callable<Download>` либо другой подходящей задачей с результатом:

```java
Callable<Download> downloadTask = () -> download(url);
Future<Download> future = executor.submit(downloadTask);
```

`Runnable` результата не возвращает, а `Callable<T>` возвращает значение типа `T` и может выбросить checked exception (проверяемое исключение).

## Завершение ExecutorService

Потоки пула являются ресурсом. После работы executor нужно закрыть:

```java
executor.shutdown();
```

`shutdown()` перестаёт принимать новые задачи, но даёт уже принятым завершиться. Если нужно дождаться остановки ограниченное время:

```java
executor.shutdown();

if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

`shutdownNow()` не гарантирует мгновенную остановку. Он пытается прервать выполняющиеся задачи через interruption (прерывание), поэтому код задачи должен корректно реагировать на него. Подробный контракт описан в [документации `ExecutorService`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ExecutorService.html).

> **Главная мысль:** `Executor` отделяет задачу от политики выполнения. `ExecutorService` добавляет результаты и жизненный цикл, `Executors` создаёт готовые реализации, а `ThreadPoolExecutor` непосредственно управляет worker-потоками и очередью.

## В живом проекте

- [Создание фиксированного пула](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L23-L26)
- [Отправка `Callable` и получение `Future`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L28-L37)
- [Отмена задачи через `Future`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L57-L68)
- [Корректное завершение `ExecutorService`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L70-L80)

## Дальше

Теперь соберём правила, по которым можно разбирать любой многопоточный код.

---

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →
