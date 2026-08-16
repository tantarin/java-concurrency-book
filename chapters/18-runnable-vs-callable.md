# Runnable vs. Callable: два контракта задачи

> Действие без результата или вычисление с результатом и ошибкой

← [Границы computeIfAbsent](./17-compute-if-absent-safety.md) · [Executor](./18-executor.md) →

## Задача перед теорией: узнать размер файла

Нужно передать в фоновое выполнение задачу, которая узнает размер файла. Нам важны две вещи:

- получить вычисленный `long`;
- не потерять `IOException`, если файл прочитать нельзя.

Можно описать работу через `Runnable`:

```java
Runnable task = () -> {
    long size = Files.size(file); // не компилируется
};
```

Появляются две проблемы. `run()` ничего не возвращает, а `Files.size()` бросает checked exception (проверяемое исключение), которое `run()` не разрешает объявить. Значит, результат придётся записывать во внешнее состояние, а исключение — ловить или оборачивать.

Но существует второй контракт — `Callable<V>`:

```java
Callable<Long> task = () -> Files.size(file);
```

Почему один вариант подходит, а другой нет? Сначала построим карту.

## Где находятся и когда появились

`Runnable` находится в `java.lang`, поэтому импорт не нужен. Он существует с Java 1.0 и используется не только многопоточностью: это общий контракт действия.

`Callable` находится в `java.util.concurrent`:

```java
import java.util.concurrent.Callable;
```

Он появился в Java 5 вместе с concurrency utilities (утилитами конкурентного программирования) из JSR 166. Его задача — представить вычисление, которое возвращает значение и может завершиться исключением.

## Контракты интерфейсов

Упрощённо они выглядят так:

```java
@FunctionalInterface
public interface Runnable {
    void run();
}

@FunctionalInterface
public interface Callable<V> {
    V call() throws Exception;
}
```

Оба являются functional interfaces (функциональными интерфейсами): имеют один абстрактный метод, поэтому их удобно создавать лямбдами.

| Вопрос | `Runnable` | `Callable<V>` |
|---|---|---|
| Метод | `run()` | `call()` |
| Результат метода | `void` | `V` |
| Checked exception в сигнатуре | нет | `throws Exception` |
| Можно передать в `Thread` | да | напрямую нет |
| Можно передать в `ExecutorService.submit()` | да | да |
| Типичный смысл | выполнить действие | вычислить значение |

## Когда выбирать Runnable

`Runnable` подходит, когда завершённого действия достаточно и отдельный результат не нужен:

```java
Runnable refreshCache = () -> cache.refresh();
Runnable writeAudit = () -> audit.log("download started");
```

Его напрямую принимает `Thread`:

```java
Thread thread = new Thread(refreshCache);
thread.start();
```

Важно различать `run()` и `start()`. Вызов `task.run()` — обычный синхронный вызов метода в текущем потоке. `thread.start()` просит JVM запустить новый поток, который затем вызовет `run()`.

Если `Runnable` всё же должен сообщить данные, ему требуется внешний канал: потокобезопасное состояние, очередь, callback или другой объект. Это усложняет простой сценарий вычисления результата.

## Когда выбирать Callable

`Callable<V>` подходит, если задача должна вернуть значение:

```java
Callable<Long> calculateSize = () -> Files.size(file);
```

Параметр `V` задаёт тип результата: здесь `call()` возвращает `Long`. Поскольку метод объявляет `throws Exception`, лямбда может не оборачивать `IOException` вручную.

`Thread` принимает только `Runnable`, поэтому `Callable` обычно отправляют в `ExecutorService`:

```java
Future<Long> future = executor.submit(calculateSize);
long size = future.get();
```

`submit()` возвращает `Future<Long>` (будущий результат). `get()` ждёт завершения и затем:

- возвращает значение;
- либо бросает `ExecutionException`, внутри которого лежит исключение задачи;
- либо бросает `InterruptedException`, если ожидающий поток прервали.

Исключение не исчезает, но пересекает границу потоков через `Future`.

## Runnable тоже можно отправить через submit

Это корректный код:

```java
Future<?> future = executor.submit(refreshCache);
future.get();
```

Такой `Future` позволяет дождаться выполнения и узнать об ошибке, но успешный `get()` возвращает `null`: метод `run()` не произвёл значения.

Есть и перегрузка с заранее заданным результатом:

```java
Future<String> future = executor.submit(refreshCache, "done");
```

Она вернёт `"done"` после успешного выполнения, однако это не результат вычисления внутри `Runnable`. Если значение вычисляет сама задача, `Callable<V>` выражает намерение яснее.

## Как Executor связывает оба интерфейса

```text
Runnable ── submit() ──→ Future<?>       успешный результат null
Callable<V> ─ submit() → Future<V>       вычисленное значение V

Runnable ── execute() ─→ результата нет
```

`execute()` объявлен в базовом `Executor` и принимает только `Runnable`. Перегрузки `submit()` объявлены в `ExecutorService`. Поэтому знание контрактов задачи логически предшествует изучению исполнителя.

Внутри стандартной библиотеки `FutureTask<V>` может быть одновременно `Runnable` и `Future<V>`. Это адаптер: worker умеет запустить его как `Runnable`, а вызывающий код — получить результат как `Future`.

## Как выбрать

```text
Нужно только выполнить действие?
    да → Runnable
    нет, нужно вычисленное значение → Callable<V>

Задача естественно бросает checked exception?
    да → обычно Callable<V>
```

Не выбирай `Runnable` только потому, что он знакомее. Запись результата во внешнюю переменную создаёт shared mutable state (общее изменяемое состояние), о безопасности которого придётся рассуждать отдельно.

## В учебном проекте

В отдельном Maven-модуле одна и та же задача описана обоими способами:

- [`Runnable`: внешнее состояние и оборачивание `IOException`](https://github.com/tantarin/java-concurrency-examples/blob/48d6d735d1660695c1b476358b67ccad65f569fe/tasks/runnable-vs-callable/src/main/java/io/github/tantarin/concurrency/tasks/FileSizeTasks.java#L13-L21)
- [`Callable<Long>`: результат и checked exception в контракте](https://github.com/tantarin/java-concurrency-examples/blob/48d6d735d1660695c1b476358b67ccad65f569fe/tasks/runnable-vs-callable/src/main/java/io/github/tantarin/concurrency/tasks/FileSizeTasks.java#L23-L25)
- [`Callable` → `submit()` → `Future<Long>`](https://github.com/tantarin/java-concurrency-examples/blob/48d6d735d1660695c1b476358b67ccad65f569fe/tasks/runnable-vs-callable/src/test/java/io/github/tantarin/concurrency/tasks/FileSizeTasksTest.java#L17-L28)
- [передача ошибки задачи через `ExecutionException`](https://github.com/tantarin/java-concurrency-examples/blob/48d6d735d1660695c1b476358b67ccad65f569fe/tasks/runnable-vs-callable/src/test/java/io/github/tantarin/concurrency/tasks/FileSizeTasksTest.java#L40-L51)

## Проверь себя

1. Почему `task.run()` не создаёт новый поток?
2. Как получить вычисленное значение из `Callable<Long>`?
3. Что вернёт `get()` у успешно завершившегося `Future<?>`, созданного из `Runnable`?
4. Почему запись результата `Runnable` в обычное поле может создать проблему видимости?
5. Почему `ExecutionException` содержит исходную ошибку, а не заменяет её смысл?

## Упражнение

Создай `Callable<String>`, который читает первую строку файла. Отправь его через `ExecutorService`, проверь результат тестом, а затем передай отсутствующий файл и проверь причину внутри `ExecutionException`.

> **Главная мысль:** `Runnable` описывает действие без возвращаемого значения, а `Callable<V>` — вычисление результата `V`, которое может бросить checked exception. Исполнитель определяет, где выполнить задачу; интерфейс задачи определяет, что вызывающий код сможет получить после выполнения.

## Первоисточники

- [Java API: `Runnable`](https://docs.oracle.com/javase/8/docs/api/java/lang/Runnable.html)
- [Java API: `Callable`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/Callable.html)
- [Java API: `ExecutorService.submit()`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ExecutorService.html)
- [Java API: `FutureTask`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/FutureTask.html)

## Дальше

Теперь известны два контракта задачи. Следующий вопрос: кто принимает эти задачи, ограничивает число потоков, возвращает `Future` и управляет завершением? Для этого нужен Executor Framework.

---

← [Границы computeIfAbsent](./17-compute-if-absent-safety.md) · [Executor](./18-executor.md) →
