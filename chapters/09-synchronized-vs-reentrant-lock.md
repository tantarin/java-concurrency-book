# synchronized vs. ReentrantLock

> Встроенный монитор или явный управляемый lock

← [wait(), notify() и notifyAll()](./09-wait-notify.md) · [Deadlock vs. livelock](./09-deadlock-vs-livelock.md) →

## Задача перед теорией: две группы ожидающих

Вернёмся к ограниченному буферу. Producers ждут свободное место, consumers — новый элемент. В реализации через монитор у объекта один wait set (набор ожидающих):

```java
public synchronized void put(E element) throws InterruptedException {
    while (isFull()) {
        wait();
    }
    add(element);
    notifyAll();
}
```

`notifyAll()` будит обе группы. Каждый поток снова захватывает монитор и проверяет своё условие, хотя после добавления элемента продолжить могут только consumers.

Хотелось бы иметь две отдельные очереди ожидания:

```text
notEmpty → ждут только consumers
notFull  → ждут только producers
```

Кроме того, иногда нужны дополнительные политики:

- отказаться от ожидания, если lock не получен за 100 ms;
- прервать поток во время получения lock;
- попробовать получить lock без ожидания;
- попросить более справедливый порядок доступа.

Обычный `synchronized` такого API не предоставляет. Для этих случаев существует `ReentrantLock`.

## Сначала карта понятий

Оба инструмента обеспечивают mutual exclusion (взаимное исключение): в критической секции находится не больше одного потока.

```text
Locking в Java
├── intrinsic lock / monitor
│   └── synchronized + wait/notify
└── explicit lock
    └── Lock interface
        └── ReentrantLock + Condition
```

Intrinsic lock (встроенный lock) связан с каждым объектом Java и управляется конструкцией `synchronized`.

Explicit lock (явный lock) — отдельный объект с методами получения и освобождения. `ReentrantLock` — основная реализация интерфейса `Lock` общего назначения.

## Где находится и когда появился ReentrantLock

Классы входят в стандартную библиотеку:

```java
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;
```

Пакет `java.util.concurrent.locks` появился в Java 5 как часть JSR 166. `synchronized` — ключевое слово языка и использует monitor-механику JVM; `ReentrantLock` — обычный Java-класс с расширенным API блокировки.

## Базовая запись

Через `synchronized`:

```java
synchronized (lock) {
    changeState();
}
```

Монитор освобождается автоматически при любом выходе из блока, включая исключение.

Через `ReentrantLock`:

```java
ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    changeState();
} finally {
    lock.unlock();
}
```

Освобождение ручное, поэтому `unlock()` обязательно помещают в `finally`. Если забыть его, остальные потоки могут навсегда потерять доступ.

`try` начинается после успешного `lock()`. Если используется метод получения lock, который может завершиться без захвата, `unlock()` вызывают только когда захват действительно состоялся.

## Главное сравнение

| Возможность | `synchronized` | `ReentrantLock` |
|---|---|---|
| Взаимное исключение | да | да |
| Повторный вход владельца | да | да |
| Автоматическое освобождение | да | нет, нужен `finally` |
| Попытка без ожидания | нет | `tryLock()` |
| Попытка с таймаутом | нет | `tryLock(timeout, unit)` |
| Прерываемое получение | нет | `lockInterruptibly()` |
| Несколько очередей условий | один wait set объекта | несколько `Condition` |
| Настраиваемая fairness | нет | конструктор с `true` |
| Диагностические методы | ограничены | есть состояние lock и очередей |

Если дополнительных возможностей не нужно, `synchronized` обычно проще и безопаснее.

## Почему оба называются reentrant

Reentrancy (повторный вход) означает: поток, уже владеющий lock, может получить его ещё раз без блокировки самого себя.

Это работает у обоих инструментов:

```java
synchronized void outer() {
    inner();
}

synchronized void inner() {
    // тот же поток повторно входит в monitor this
}
```

`ReentrantLock` хранит hold count (счётчик захватов). Каждый успешный `lock()` владельца должен иметь соответствующий `unlock()`:

```java
lock.lock();       // hold count = 1
lock.lock();       // hold count = 2
lock.unlock();     // hold count = 1
lock.unlock();     // lock свободен
```

Название `ReentrantLock` подчёркивает свойство класса, но `synchronized` тоже реентерабелен.

## tryLock(): не ждать бесконечно

Мгновенная попытка:

```java
if (lock.tryLock()) {
    try {
        useResource();
    } finally {
        lock.unlock();
    }
} else {
    reportBusy();
}
```

Попытка с таймаутом:

```java
if (lock.tryLock(100, TimeUnit.MILLISECONDS)) {
    try {
        useResource();
    } finally {
        lock.unlock();
    }
}
```

Это позволяет ограничить ожидание и выбрать явную реакцию: отменить операцию, вернуть ошибку или повторить позже. Но бесконечный немедленный retry может создать [livelock](./09-deadlock-vs-livelock.md).

## lockInterruptibly(): прерываемое получение

```java
lock.lockInterruptibly();
try {
    useResource();
} finally {
    lock.unlock();
}
```

Если поток прервут, пока он ждёт lock, метод бросит `InterruptedException`. Это полезно для отменяемых задач и корректного завершения сервисов.

Поток, ожидающий входа в обычный `synchronized`, не может прекратить это ожидание через interruption. Флаг прерывания может быть установлен, но монитор всё равно нужно получить.

## Condition вместо wait/notify

`Condition` (условие ожидания) создаётся конкретным `Lock`:

```java
ReentrantLock lock = new ReentrantLock();
Condition notEmpty = lock.newCondition();
Condition notFull = lock.newCondition();
```

Соответствия API:

| Monitor API | Condition API |
|---|---|
| `wait()` | `await()` |
| `notify()` | `signal()` |
| `notifyAll()` | `signalAll()` |

Контракт похож:

- перед `await()` или `signal()` нужно владеть связанным lock;
- `await()` освобождает lock и перед возвратом захватывает его снова;
- условие проверяется в `while` из-за конкуренции и spurious wakeup;
- `signal()` не освобождает lock немедленно.

Отличие — один `ReentrantLock` может создать несколько `Condition`, то есть несколько независимых wait sets.

## Буфер с двумя Condition

```java
private final ReentrantLock lock = new ReentrantLock();
private final Condition notEmpty = lock.newCondition();
private final Condition notFull = lock.newCondition();
```

Producer ждёт только `notFull` и сигнализирует только `notEmpty`:

```java
public void put(E element) throws InterruptedException {
    lock.lockInterruptibly();
    try {
        while (size == elements.length) {
            notFull.await();
        }
        add(element);
        notEmpty.signal();
    } finally {
        lock.unlock();
    }
}
```

Consumer использует обратную пару:

```java
public E take() throws InterruptedException {
    lock.lockInterruptibly();
    try {
        while (size == 0) {
            notEmpty.await();
        }
        E element = remove();
        notFull.signal();
        return element;
    } finally {
        lock.unlock();
    }
}
```

Теперь после `put()` не нужно будить producers, которым новое состояние не помогает.

## Fairness: справедливый lock

```java
ReentrantLock fairLock = new ReentrantLock(true);
```

Fairness (справедливость доступа) означает стремление отдавать lock потоку, который ждёт дольше. Это может уменьшить starvation, но часто снижает throughput из-за дополнительных переключений и меньшей свободы планирования.

Справедливый `ReentrantLock` не гарантирует справедливое планирование самих потоков операционной системой. Кроме того, мгновенный `tryLock()` может захватить свободный lock, не соблюдая fairness policy.

Не включай fairness «на всякий случай»: сначала должна существовать измеренная или контрактная потребность.

## Видимость изменений

Успешные `lock()`/`unlock()` дают те же memory synchronization effects (эффекты синхронизации памяти), что захват и освобождение monitor через `synchronized`. Запись до `unlock()` становится доступна потоку после последующего успешного `lock()` того же объекта.

Подробную формальную связь разберём в главах про [visibility](./10-visibility.md) и [happens-before](./12-happens-before.md).

## Что быстрее

Нельзя выбирать `ReentrantLock` по старому правилу «он быстрее `synchronized`». JVM оптимизирует встроенные monitors, а результат зависит от версии JDK, конкуренции и формы критической секции.

Выбирай по необходимому контракту:

```text
Нужна только короткая критическая секция
    → synchronized

Нужны tryLock, timeout, interruptible acquisition,
fairness или несколько Condition
    → ReentrantLock
```

Производительность проверяют benchmark (измерением производительности) на подходящей версии JDK и реалистичной нагрузке, а не названием класса.

## Когда synchronized предпочтительнее

- небольшая критическая секция;
- один простой monitor-инвариант;
- не нужны таймауты и прерываемое получение;
- достаточно одного wait set или ожидания вообще нет;
- важнее минимизировать риск забыть освобождение.

## Когда нужен ReentrantLock

- получение lock должно иметь таймаут;
- ожидающий lock поток нужно уметь прервать;
- необходима попытка `tryLock()`;
- одному защищённому состоянию нужны разные `Condition`;
- нужна осознанно выбранная fairness policy;
- требуются диагностические методы явного lock.

`ReentrantLock` не защищает код сам по себе. Все обращения к состоянию должны соблюдать один протокол, как и с `synchronized`.

## В учебном проекте

Рядом существуют две реализации одной задачи:

- [буфер через `synchronized` и общий wait set](https://github.com/tantarin/java-concurrency-examples/blob/741f2fd2640a7400f64033ac9082b2e77744f9de/synchronization/wait-notify-bounded-buffer/src/main/java/io/github/tantarin/concurrency/waitnotify/BoundedBuffer.java#L18-L42)
- [создание `ReentrantLock`, `notEmpty` и `notFull`](https://github.com/tantarin/java-concurrency-examples/blob/0d7df930e25f2dd3d61a3415e64a5e447e3d5310/synchronization/reentrant-lock-bounded-buffer/src/main/java/io/github/tantarin/concurrency/locks/ConditionBoundedBuffer.java#L7-L14)
- [`put()`: `lockInterruptibly()`, `await()` и `signal()`](https://github.com/tantarin/java-concurrency-examples/blob/0d7df930e25f2dd3d61a3415e64a5e447e3d5310/synchronization/reentrant-lock-bounded-buffer/src/main/java/io/github/tantarin/concurrency/locks/ConditionBoundedBuffer.java#L23-L37)
- [`take()` и гарантированный `unlock()`](https://github.com/tantarin/java-concurrency-examples/blob/0d7df930e25f2dd3d61a3415e64a5e447e3d5310/synchronization/reentrant-lock-bounded-buffer/src/main/java/io/github/tantarin/concurrency/locks/ConditionBoundedBuffer.java#L39-L55)
- [тесты двух условий](https://github.com/tantarin/java-concurrency-examples/blob/0d7df930e25f2dd3d61a3415e64a5e447e3d5310/synchronization/reentrant-lock-bounded-buffer/src/test/java/io/github/tantarin/concurrency/locks/ConditionBoundedBufferTest.java#L14-L49)

## Типичные ошибки

- вызвать `lock()` и забыть `unlock()` в `finally`;
- вызвать `unlock()` в потоке, который не владеет lock;
- вызвать `await()` или `signal()` без владения связанным `ReentrantLock`;
- смешать `synchronized` и `ReentrantLock` для защиты одного состояния;
- заменить блокировку циклом бесконечных `tryLock()`;
- считать fair lock гарантией строгого порядка выполнения;
- выбирать явный lock без необходимости и усложнять код.

## Проверь себя

1. Освобождается ли `ReentrantLock` автоматически при исключении?
2. Является ли `synchronized` reentrant?
3. Чем `lockInterruptibly()` отличается от входа в `synchronized`?
4. Как `Condition` связан с `wait()` и `notify()`?
5. Зачем буферу две очереди `notEmpty` и `notFull`?
6. Когда обычный `synchronized` лучше `ReentrantLock`?

## Упражнение

Добавь в `ConditionBoundedBuffer` метод `offer(E element, long timeout, TimeUnit unit)`. Используй `awaitNanos()` так, чтобы повторное пробуждение уменьшало оставшийся таймаут, и гарантируй `unlock()` при любом исходе.

> **Главная мысль:** `synchronized` проще и автоматически освобождает monitor. `ReentrantLock` требует ручного `unlock()` в `finally`, но даёт `tryLock()`, таймаут, прерываемое получение, fairness и несколько `Condition`. Выбирать нужно по контракту, а не по мифу о скорости.

## Первоисточники

- [Java API: `Lock`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/locks/Lock.html)
- [Java API: `ReentrantLock`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/locks/ReentrantLock.html)
- [Java API: `Condition`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/locks/Condition.html)

## Дальше

Теперь известны встроенные и явные locks, включая `tryLock()` и прерываемое ожидание. Следующая глава покажет, как неправильный порядок locks создаёт deadlock, а неудачная стратегия повторов — livelock.

---

← [wait(), notify() и notifyAll()](./09-wait-notify.md) · [Deadlock vs. livelock](./09-deadlock-vs-livelock.md) →
