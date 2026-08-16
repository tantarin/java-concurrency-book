# Виртуальные потоки в Java

> Virtual threads, carrier threads и блокирующий I/O

← [Fork/Join](./18-fork-join.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →

## Задача перед теорией: монитор доступности URL

Представь сервис, который раз в минуту проверяет доступность 20 000 URL. Для каждого адреса он отправляет HTTP-запрос и сохраняет статус ответа:

```java
CheckResult check(URI uri) throws IOException, InterruptedException {
    HttpRequest request = HttpRequest.newBuilder(uri).build();
    HttpResponse<Void> response = httpClient.send(
        request,
        HttpResponse.BodyHandlers.discarding()
    );
    return new CheckResult(uri, response.statusCode());
}
```

Метод использует blocking I/O (блокирующий ввод-вывод): во время `send()` поток в основном ждёт ответ сети и почти не использует процессор.

У задачи есть условия:

- проверки независимы друг от друга;
- одновременно могут ожидать тысячи HTTP-ответов;
- время ответа отличается: один сервер отвечает за 50 ms, другой — за 20 секунд;
- вычислений почти нет;
- хочется сохранить простой последовательный код без цепочек callbacks;
- нельзя создавать 20 000 дорогих потоков операционной системы.

Последовательный цикл использует мало ресурсов, но работает слишком долго:

```java
for (URI uri : urls) {
    results.add(check(uri));
}
```

Пул из 100 platform threads выполняет проверки параллельно, но одновременно ждать сеть могут только 100 задач. Если эти workers заняты медленными серверами, остальные 19 900 проверок остаются в очереди, хотя CPU почти свободен.

```text
20 000 независимых I/O-задач
          ↓
pool из 100 platform threads
          ↓
100 задач ждут сеть
19 900 задач ждут свободный worker
```

Прежде чем читать дальше, попробуй выбрать решение. Ответь на вопросы:

1. Нужен ли каждой проверке дорогой platform thread на всё время ожидания?
2. Ускорит ли увеличение числа CPU cores ожидание HTTP?
3. Хотим ли мы ограничить именно количество потоков или количество запросов к одному серверу?
4. Можно ли представить каждую проверку отдельным дешёвым потоком?

К этой задаче вернёмся после устройства и API virtual threads.

## Зачем понадобились ещё одни потоки

Platform thread (платформенный поток) обычно связан с потоком операционной системы один к одному. Это универсальный, но сравнительно дорогой ресурс: каждому потоку нужны нативные структуры и stack.

Пулы помогают ограничить число platform threads, но вместе с ограничением потоков ограничивают число задач, которые могут одновременно ждать блокирующий I/O:

```text
pool из 4 platform threads

worker 1 → ждёт HTTP
worker 2 → ждёт JDBC
worker 3 → ждёт файл
worker 4 → ждёт HTTP

новая задача → остаётся в очереди,
хотя процессор почти не занят
```

Большинство workers ничего не вычисляют — они ожидают сеть, базу или диск. Но пока platform thread заблокирован, его нельзя использовать для другой задачи.

**Virtual thread (виртуальный поток)** — лёгкий поток, которым управляет JDK, а не операционная система напрямую. Он позволяет сохранить простой последовательный код с блокирующими вызовами и одновременно обслуживать очень много ожидающих задач.

## Когда появились virtual threads

Virtual threads впервые появились как preview feature (предварительная возможность) в JDK 19, ещё раз прошли preview в JDK 20 и стали финальной частью платформы в **Java 21** через [JEP 444](https://openjdk.org/jeps/444).

Для их использования без preview-флагов нужна Java 21 или новее:

```bash
java --version
```

Основные API находятся в двух знакомых местах:

```java
java.lang.Thread
java.util.concurrent.Executors
```

Virtual thread не является отдельным классом. Это всё тот же объект `java.lang.Thread`, для которого `thread.isVirtual()` возвращает `true`.

## Platform thread и virtual thread

| Свойство | Platform thread | Virtual thread |
|---|---|---|
| Кто реализует | ОС и JVM | JDK |
| Связь с OS thread | обычно один к одному | много virtual threads используют меньшее число OS threads |
| Стоимость создания | сравнительно высокая | низкая |
| Обычный срок жизни | долгий, переиспользуется | часто равен одной задаче |
| Нужно объединять в пул | часто да | нет |
| Хороший сценарий | любые задачи, особенно ограниченное CPU-вычисление | множество задач, ожидающих блокирующий I/O |

Virtual thread не отменяет platform threads. Чтобы выполнить машинные инструкции, ему всё равно нужен настоящий поток ОС.

## Carrier thread: поток-носитель

JVM scheduler (планировщик JVM) назначает virtual thread на platform thread. Такой platform thread называется **carrier thread (поток-носитель)**.

```text
virtual thread 1 ─┐
virtual thread 2 ─┼── планировщик JVM ──→ carrier 1 ──→ OS thread
virtual thread 3 ─┤
virtual thread 4 ─┘                    └→ carrier 2 ──→ OS thread
```

Когда virtual thread начинает исполняться на carrier, это называется **mounting (монтирование)**. Когда он освобождает carrier — **unmounting (размонтирование)**.

При поддерживаемом блокирующем I/O происходит следующее:

```text
1. virtual thread выполняется на carrier
2. вызывает блокирующее чтение из сети
3. JVM сохраняет состояние virtual thread
4. virtual thread освобождает carrier
5. carrier выполняет другой virtual thread
6. данные приходят
7. первый virtual thread снова назначается на carrier
8. выполнение продолжается со следующей строки
```

Код выглядит обычным и последовательным:

```java
String body = httpClient.send(request, BodyHandlers.ofString()).body();
save(body);
```

Разработчику не нужно вручную превращать каждое ожидание в цепочку callbacks (обратных вызовов).

## Как создать virtual thread

### Самый короткий способ

```java
Thread thread = Thread.startVirtualThread(() -> {
    downloadFile();
});

thread.join();
```

`startVirtualThread()` создаёт и сразу запускает новый virtual thread.

### Через Thread.Builder

```java
Thread thread = Thread.ofVirtual()
    .name("download-book")
    .start(() -> downloadFile());
```

Builder (строитель) удобен, когда нужно задать имя или создать `ThreadFactory`.

### Через ExecutorService

```java
try (ExecutorService executor =
         Executors.newVirtualThreadPerTaskExecutor()) {

    Future<Download> future =
        executor.submit(() -> download(url));

    Download result = future.get();
}
```

`newVirtualThreadPerTaskExecutor()` переводится буквально как «executor: новый virtual thread для каждой задачи».

Несмотря на класс `Executors`, этот метод **не создаёт пул virtual threads**:

```text
task 1 → новый virtual thread 1
task 2 → новый virtual thread 2
task 3 → новый virtual thread 3
```

Закрытие executor ожидает завершения отправленных задач. `Future` по-прежнему используется для результата, ожидания и отмены.

## Возвращаемся к задаче мониторинга

Теперь сопоставим условия задачи со свойствами virtual threads:

| Условие | Почему подходит virtual thread |
|---|---|
| 20 000 независимых проверок | можно создать отдельный virtual thread для каждой задачи |
| Большая часть времени уходит на `HttpClient.send()` | во время поддерживаемого блокирующего I/O virtual thread освобождает carrier |
| Вычислений мало | задача не удерживает CPU надолго |
| Нужен простой код | можно оставить обычный блокирующий метод `check()` |
| Нельзя создавать 20 000 OS threads | virtual threads делят меньшее число carrier threads |

Решение выглядит так:

```java
try (ExecutorService executor =
         Executors.newVirtualThreadPerTaskExecutor()) {

    List<Future<CheckResult>> futures = urls.stream()
        .map(uri -> executor.submit(() -> check(uri)))
        .toList();

    List<CheckResult> results = new ArrayList<>();
    for (Future<CheckResult> future : futures) {
        results.add(future.get());
    }
}
```

Для каждой проверки создаётся свой virtual thread. Когда запрос ждёт сеть, carrier может выполнять другую проверку.

```text
20 000 проверок
      ↓
20 000 virtual threads
      ↓ JVM scheduler
небольшое число carrier platform threads
      ↓
OS threads и CPU cores
```

Мы не обещаем, что каждый удалённый сервер выдержит столько запросов. Это отдельное ограничение бизнес-ресурса. Например, число запросов к одному host можно ограничить через `Semaphore`:

```java
Semaphore hostPermits = limits.computeIfAbsent(
    uri.getHost(),
    host -> new Semaphore(20)
);

hostPermits.acquire();
try {
    return check(uri);
} finally {
    hostPermits.release();
}
```

Так архитектура выражает два разных решения:

```text
virtual thread per task
    отвечает: как дёшево представить каждую ожидающую проверку?

Semaphore per host
    отвечает: сколько запросов разрешено конкретному серверу?
```

Именно сочетание «много независимых блокирующих I/O-задач + мало вычислений + простой синхронный код» делает virtual threads подходящим решением этой задачи.

## Почему virtual threads нельзя объединять в пул

Platform threads объединяют в пул, потому что они дороги и их число нужно ограничивать.

Virtual threads дешёвы и предназначены для модели **thread-per-task (поток на задачу)**:

```text
platform threads
    дорогой ресурс → переиспользуем через pool

virtual threads
    дешёвое представление задачи → создаём новый для каждой задачи
```

Пул из 100 virtual threads искусственно разрешит только 100 одновременных ожиданий и уничтожит главное преимущество технологии.

Если нужно ограничить настоящий дефицитный ресурс — например, десять соединений с базой или пять запросов к внешнему API, — ограничивают именно его:

```java
Semaphore permits = new Semaphore(5);

permits.acquire();
try {
    callExternalService();
} finally {
    permits.release();
}
```

> Не ограничивай virtual threads ради ограничения другого ресурса. Используй `Semaphore`, connection pool или rate limiter для самого ресурса.

## Для каких задач они подходят

Virtual threads особенно полезны, когда одновременно выполняется много независимых задач, которые большую часть времени ждут:

- HTTP-запросы;
- JDBC и базы данных;
- чтение и запись файлов;
- сетевые сокеты;
- обработка большого числа клиентских запросов;
- fan-out — параллельные запросы к нескольким сервисам.

Пример fan-out (разветвления запросов):

```java
try (ExecutorService executor =
         Executors.newVirtualThreadPerTaskExecutor()) {

    Future<User> user = executor.submit(() -> loadUser(id));
    Future<List<Order>> orders = executor.submit(() -> loadOrders(id));

    return new Profile(user.get(), orders.get());
}
```

Обе операции могут ждать I/O одновременно, при этом код остаётся обычным последовательным Java-кодом.

## Для каких задач они не дают ускорения

Virtual threads не делают вычисления быстрее и не добавляют процессорных ядер.

```text
1000 CPU-bound virtual threads
        ↓
всё равно делят доступные CPU cores
```

Для длительных CPU-bound tasks (задач, ограниченных процессором) полезный параллелизм обычно близок к числу доступных ядер. Здесь подходят ограниченный pool, [Fork/Join](./18-fork-join.md) или другие инструменты параллельных вычислений.

Oracle формулирует различие так: virtual threads дают **scale (масштабируемость и throughput)**, а не **speed (ускорение и уменьшение latency)**.

- throughput (пропускная способность) — сколько задач система завершает за единицу времени;
- latency (задержка) — сколько времени занимает одна задача.

Virtual threads могут повысить throughput системы с множеством ожиданий, но один HTTP-запрос сам по себе не станет быстрее.

## Блокировка и pinning

**Pinning (закрепление)** означает, что заблокированный virtual thread не может временно освободить carrier. Тогда вместе с virtual thread простаивает и дорогой platform thread.

Поведение зависит от версии JDK:

- в JDK 21–23 длительная блокировка внутри `synchronized` могла закреплять carrier;
- начиная с JDK 24, [JEP 491](https://openjdk.org/jeps/491) устранил pinning при обычной работе с `synchronized` и мониторами;
- некоторые взаимодействия с native code и Foreign Function & Memory API всё ещё могут закреплять carrier.

Pinning не обязательно нарушает корректность, но длительное и массовое закрепление может уменьшить масштабируемость.

## ThreadLocal и большое число потоков

Virtual threads поддерживают `ThreadLocal`, но значение хранится отдельно для каждого потока. Если создать миллион virtual threads и положить в каждый большой объект, экономия памяти исчезнет.

```java
ThreadLocal<byte[]> buffer =
    ThreadLocal.withInitial(() -> new byte[1_000_000]);
```

Такой код потенциально выделяет большой буфер для каждого virtual thread. Не используй `ThreadLocal` как безразмерный кеш, если приложение создаёт огромное число виртуальных потоков.

## Отмена и interruption

Virtual thread остаётся обычным `Thread` по контракту Java. Для cooperative cancellation (совместной отмены) используется interruption:

```java
Future<?> future = executor.submit(this::downloadFile);
future.cancel(true);
```

Блокирующая операция может завершиться `InterruptedException`. Не проглатывай прерывание:

```java
try {
    queue.take();
} catch (InterruptedException exception) {
    Thread.currentThread().interrupt();
    return;
}
```

## Как принять решение

```text
много одновременных задач?
        │
        ├── нет → обычный подход достаточен
        │
        └── да
             │
             ├── задачи в основном ждут I/O
             │       → virtual thread per task
             │
             └── задачи долго считают на CPU
                     → ограниченный platform-thread pool
```

Проверочные вопросы:

1. Задачи большую часть времени считают или ждут?
2. Нужно уменьшить latency одной задачи или увеличить общий throughput?
3. Ограничиваем ли мы потоки вместо настоящего дефицитного ресурса?
4. Корректно ли код обрабатывает interruption?
5. Не хранит ли каждый virtual thread слишком много данных в `ThreadLocal`?
6. Какая версия JDK используется и актуальны ли для неё ограничения pinning?

> **Главная мысль:** virtual thread — дешёвое представление одной ожидающей задачи. Создавай новый virtual thread для каждой I/O-bound задачи, не объединяй их в пул и отдельно ограничивай реальные дефицитные ресурсы.

## Первоисточники

- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
- [Oracle: Virtual Threads in Java 21](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)
- [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)

## Дальше

Теперь соберём правила, по которым можно разбирать многопоточный код независимо от типа используемых потоков.

---

← [Fork/Join](./18-fork-join.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →
