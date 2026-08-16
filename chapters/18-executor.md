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
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
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

## Что такое thread pool: пул потоков

**Thread pool (пул потоков)** — объект, который владеет набором переиспользуемых worker threads (рабочих потоков) и распределяет между ними поступающие задачи.

Слово *pool* переводится как «общий запас» или «общий набор». Приложение не создаёт новый `Thread` для каждой задачи, а использует общий набор уже существующих рабочих потоков.

```text
задачи приложения
 task 1 ─┐
 task 2 ─┼──→ очередь задач
 task 3 ─┘          │
                    ↓
             ┌──────────────┐
             │ thread pool  │
             │              │
             │ worker 1     │
             │ worker 2     │
             │ worker 3     │
             └──────────────┘
```

Каждый worker выполняет примерно такой цикл:

```java
while (!stopped) {
    Runnable task = queue.take();
    task.run();
}
```

Это упрощённая модель, а не исходный код `ThreadPoolExecutor`. Она показывает главную идею:

1. Приложение отправляет задачу.
2. Если worker свободен, он начинает её выполнять.
3. Если все workers заняты, задача обычно ждёт в очереди.
4. После завершения worker не уничтожается, а берёт следующую задачу.

Потоки могут создаваться заранее или лениво по мере необходимости — это зависит от настроек реализации. Существенно то, что пул **владеет потоками и переиспользует их для разных задач**.

### Зачем переиспользовать потоки

Создание platform thread требует ресурсов:

- памяти для stack;
- нативных структур JVM и операционной системы;
- времени на создание и завершение;
- переключений контекста между большим числом потоков.

Пул позволяет контролировать этот расход:

```text
1000 задач + new Thread для каждой
    → потенциально 1000 потоков

1000 задач + pool из 4 workers
    → 4 потока выполняют задачи партиями
```

Пул не уменьшает число задач. Он ограничивает число задач, которые могут выполняться одновременно, а остальные организованно ждут.

### Из чего состоит пул

Обычно у пула есть:

| Часть | За что отвечает |
|---|---|
| Worker threads (рабочие потоки) | непосредственно вызывают код задач |
| Task queue (очередь задач) | хранит задачи, которым пока не достался worker |
| Size policy (политика размера) | определяет минимальное и максимальное число потоков |
| Rejection policy (политика отклонения) | решает, что делать, если новую задачу нельзя принять |
| Thread factory (фабрика потоков) | создаёт и настраивает worker threads |
| Lifecycle (жизненный цикл) | запуск, `shutdown` и завершение пула |

Настройки образуют **execution policy (политику выполнения)**: сколько задач работает одновременно, где ждут остальные и что происходит при перегрузке.

### Пул и Executor — не одно и то же

`Executor` — общий интерфейс «прими и выполни задачу». Он может вообще не иметь пула и выполнить команду прямо в вызывающем потоке.

Thread pool — один из способов реализовать executor:

```text
Executor
    абстракция выполнения задачи

ThreadPoolExecutor
    реализация ExecutorService с пулом потоков и очередью
```

> **Главная мысль:** пул — это управляемый набор переиспользуемых рабочих потоков. Задачи приходят и уходят, а workers остаются и выполняют их по очереди.

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

`Executors` — не executor и не интерфейс. Это utility class (служебный класс) со **static factory methods (статическими фабричными методами)**.

Factory method (фабричный метод) создаёт и настраивает объект за нас. Поэтому мы вызываем метод через имя класса и не пишем конструктор конкретной реализации:

```java
ExecutorService pool =
    Executors.newFixedThreadPool(4);
```

Слово `new` в имени метода означает «создай настроенный executor», но это обычный статический метод, а не оператор `new` языка Java.

Три приведённых метода создают [пулы потоков](#что-такое-thread-pool-пул-потоков) с разной политикой:

| Метод | Сколько worker-потоков | Что происходит с лишними задачами | Когда подходит |
|---|---:|---|---|
| `newFixedThreadPool(n)` | ровно `n` активных workers | ждут в общей очереди | ограниченное параллельное выполнение |
| `newSingleThreadExecutor()` | один worker | ждут в очереди и выполняются последовательно | когда важен порядок задач |
| `newScheduledThreadPool(n)` | до `n` workers для наступивших задач | ждут назначенного времени | задержанные и периодические задачи |

#### newFixedThreadPool(n): фиксированный пул

```java
ExecutorService pool =
    Executors.newFixedThreadPool(4);
```

Параметр `4` задаёт число worker threads (рабочих потоков). Одновременно могут выполняться не более четырёх задач:

```text
task 1 → worker 1
task 2 → worker 2
task 3 → worker 3
task 4 → worker 4
task 5 → очередь
task 6 → очередь
```

Когда worker завершает задачу, он берёт следующую из очереди. Потоки переиспользуются: для каждой задачи новый `Thread` не создаётся.

Подходит для менеджера загрузок, если мы хотим разрешить, например, только четыре одновременных скачивания.

Важное ограничение: фабрика использует очередь без фиксированной ёмкости. Число потоков ограничено, но при слишком быстром поступлении задач очередь может расти и расходовать память.

#### newSingleThreadExecutor(): один последовательный worker

```java
ExecutorService executor =
    Executors.newSingleThreadExecutor();
```

Все задачи выполняет один worker в порядке поступления:

```text
очередь: task 1 → task 2 → task 3

worker выполняет:
task 1
затем task 2
затем task 3
```

Одновременно две задачи из этого executor не выполняются. Это полезно, когда:

- изменения должны применяться последовательно;
- требуется сохранить порядок событий;
- один выделенный поток владеет изменяемым состоянием;
- фоновая работа не должна выполняться параллельно.

Это не «пул для ускорения»: один worker не даёт параллельного выполнения. Его смысл — последовательность и изоляция. Очередь здесь также не имеет фиксированной ёмкости.

#### newScheduledThreadPool(n): выполнение по времени

```java
ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(2);
```

Этот метод возвращает `ScheduledExecutorService` (планируемый сервис выполнения). Он нужен не просто для немедленной отправки задач, а для работы со временем.

Запустить один раз через пять секунд:

```java
scheduler.schedule(
    this::retryDownload,
    5,
    TimeUnit.SECONDS
);
```

Запускать по фиксированному расписанию — каждые десять секунд от планового времени старта:

```java
scheduler.scheduleAtFixedRate(
    this::printStatistics,
    0,
    10,
    TimeUnit.SECONDS
);
```

Ждать десять секунд после завершения предыдущего запуска:

```java
scheduler.scheduleWithFixedDelay(
    this::checkForUpdates,
    0,
    10,
    TimeUnit.SECONDS
);
```

Различие двух периодических методов:

```text
scheduleAtFixedRate
start ── 10 sec ── start ── 10 sec ── start

scheduleWithFixedDelay
start → finish ── 10 sec ── start → finish ── 10 sec
```

Если выполнение `scheduleAtFixedRate()` длится дольше заданного периода, следующий запуск опоздает, но два запуска одной периодической задачи не будут выполняться одновременно.

Параметр `2` означает, что две готовые к запуску задачи могут выполняться одновременно. Он не означает «выполнить задачу два раза».

Такой scheduler подходит для retry (повторной попытки), периодического сохранения прогресса, обновления статистики и обслуживания кеша.

#### Как выбрать

```text
нужно выполнять до N задач одновременно
    → newFixedThreadPool(N)

нужно выполнять задачи строго по одной
    → newSingleThreadExecutor()

нужен запуск позже или периодически
    → newScheduledThreadPool(N)
```

Это удобные фабрики для типовых политик. Если нужно явно ограничить очередь, настроить rejection policy (политику отклонения), время жизни потоков или другие детали, создают и конфигурируют `ThreadPoolExecutor` напрямую.

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
