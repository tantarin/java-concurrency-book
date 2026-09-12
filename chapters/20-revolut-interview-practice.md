# Практикум: многопоточность на интервью в Revolut

> Переводы, locks, deadlock, базы данных и concurrent-тесты

← [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) · [Оглавление](../README.md) →

Эта глава не обещает точный набор будущего интервью. Формат и задания меняются. Здесь собраны темы, которые повторяются в открытых отчётах кандидатов на Java/backend-позиции в Revolut, и упражнения, позволяющие отработать стоящие за ними принципы.

Официальное руководство Revolut советует готовить многопоточность и отдельно называет `synchronisation` (синхронизацию), `thread safety` (потокобезопасность) и `parallel processing` (параллельную обработку). Отчёты кандидатов связывают эти темы с переводом денег, load balancer, поиском ошибок в коде и блокировками базы данных.

## Карта практикума

Перед этой главой нужно понимать:

- [shared mutable state (общее изменяемое состояние)](./04-shared-mutable-state.md);
- [race condition (состояние гонки) и atomicity (атомарность)](./05-race-condition-details.md);
- [`synchronized` и монитор](./07-synchronized.md);
- [объект как lock](./08-object-as-lock.md);
- [`ReentrantLock` и его отличия от `synchronized`](./09-synchronized-vs-reentrant-lock.md);
- [deadlock (взаимную блокировку)](./09-deadlock-vs-livelock.md);
- [visibility (видимость) и `volatile`](./10-visibility.md);
- [Java Memory Model и happens-before](./12-happens-before.md);
- [семейства concurrent-коллекций](./15-concurrent-collections-overview.md);
- [композицию нескольких операций](./16-operation-composition.md);
- [`Executor` и пулы потоков](./18-executor.md).

Практика идёт в том же порядке, в котором стоит рассуждать на интервью:

```text
найти общее изменяемое состояние
              ↓
определить составную атомарную операцию
              ↓
выбрать гранулярность и порядок locks
              ↓
проверить safety, liveness и throughput
              ↓
доказать свойства конкурентным тестом
```

## 1. Главный сценарий: перевод между двумя счетами

Типовая постановка выглядит так:

> Есть два счёта. Реализуйте `transfer(from, to, amount)` для одновременных переводов. Баланс не должен становиться отрицательным, а деньги — исчезать или создаваться.

Сначала полезно назвать инварианты — условия, которые должны сохраняться после любой операции:

1. списание и зачисление происходят вместе либо не происходят вовсе;
2. сумма балансов не меняется;
3. баланс не становится отрицательным;
4. два одновременных перевода не теряют обновления.

Наивное решение нарушает их:

```java
void transfer(Account from, Account to, long amount) {
    if (from.balance() >= amount) {
        from.setBalance(from.balance() - amount);
        to.setBalance(to.balance() + amount);
    }
}
```

Проверка и изменение образуют составную операцию `check-then-act` (сначала проверить, затем действовать). Чтение и запись баланса — `read-modify-write` (прочитать, изменить, записать). Между отдельными действиями может вклиниться другой поток, поэтому потокобезопасные геттеры и сеттеры сами по себе задачу не решают.

### Почему нужно блокировать оба счёта

Операция одновременно изменяет два объекта. Lock только исходного счёта не защищает входящий баланс второго счёта от потерянных обновлений. Один глобальный lock защищает всё, но необязательно сериализует независимые переводы `A → B` и `C → D`.

Компромисс — блокировать два участвующих счёта:

```java
final class Account {
    private final long id;
    private long balance;

    Account(long id, long balance) {
        this.id = id;
        this.balance = balance;
    }

    long id() {
        return id;
    }

    long balance() {
        return balance;
    }

    void debit(long amount) {
        balance -= amount;
    }

    void credit(long amount) {
        balance += amount;
    }
}

void transfer(Account from, Account to, long amount) {
    if (amount <= 0 || from == to) {
        throw new IllegalArgumentException();
    }

    Account first = from.id() < to.id() ? from : to;
    Account second = from.id() < to.id() ? to : from;

    synchronized (first) {
        synchronized (second) {
            if (from.balance() < amount) {
                throw new IllegalStateException("insufficient funds");
            }
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

Здесь граница атомарности охватывает проверку, списание и зачисление. Все потоки берут locks в одном порядке — по стабильному `id` счёта.

### Ловушка `A → B` одновременно с `B → A`

Если каждый поток сначала блокирует `from`, порядок получится противоположным:

```text
Thread 1 держит A и ждёт B
Thread 2 держит B и ждёт A
```

Возникает deadlock. Детерминированный порядок захвата разрывает цикл ожидания. На интервью важно не только написать сортировку, но и проговорить ограничения:

- ключ порядка должен быть стабильным и уникальным;
- случай одинаковых ключей требует отдельной обработки;
- `identityHashCode` теоретически может столкнуться;
- `tryLock()` с таймаутом позволяет отказаться от ожидания, но требует аккуратного retry и освобождения locks в `finally`.

## 2. Как выбирать гранулярность lock

`Granularity` (гранулярность) — объём состояния, защищаемого одной блокировкой.

| Вариант | Корректность | Параллелизм | Цена сложности |
|---|---|---|---|
| Один lock на весь сервис | Простая | Низкий | Низкая |
| Lock на каждый счёт | Требует общего порядка | Независимые переводы параллельны | Средняя |
| Optimistic/CAS-подход | Нужны retries и защита операции над двумя счетами | Хорош при редких конфликтах | Высокая |
| Транзакция базы данных | Гарантии делегированы хранилищу | Зависит от locks и isolation level | Средняя |

Хороший ответ начинается не с названия API, а с требований: насколько часты конфликты, допустимы ли retries, нужна ли строгая консистентность и где находится authoritative state (источник истины).

### `synchronized` или `ReentrantLock`

Для короткого вложенного примера `synchronized` проще и автоматически освобождает монитор при выходе из блока. `ReentrantLock` полезен, когда нужны:

- `tryLock()` и ограниченное ожидание;
- прерываемое получение lock;
- несколько `Condition`;
- настраиваемая fairness (справедливость).

У `ReentrantLock` освобождение обязательно помещают в `finally`:

```java
lock.lock();
try {
    changeState();
} finally {
    lock.unlock();
}
```

## 3. Поиск race condition в готовом коде

В открытых отчётах упоминаются фрагменты кода, в которых нужно найти concurrency-баг. Проверяй код по чек-листу:

1. Какие данные разделяют потоки?
2. Кто и где их изменяет?
3. Какая операция состоит из нескольких действий?
4. Что обеспечивает atomicity?
5. Что обеспечивает visibility и happens-before?
6. Все ли обращения следуют одному протоколу блокировки?
7. Возможен ли цикл ожидания?
8. Не удерживается ли lock во время I/O или внешнего вызова?

Особенно часто прячутся:

- `if (!set.contains(x)) set.add(x)` — check-then-act;
- `map.put(key, map.get(key) + 1)` — read-modify-write;
- `volatileCounter++` — `volatile` не делает инкремент атомарным;
- возврат внутренней изменяемой коллекции наружу;
- итерация по обычной коллекции параллельно с изменением;
- вызов чужого кода под lock;
- захват двух locks в разном порядке.

## 4. Thread-safe load balancer

Ещё один повторяющийся формат — постепенно реализовать load balancer:

```java
register(server);
Server next();
```

Затем появляются требования:

- не больше десяти серверов;
- запрет дубликатов;
- round-robin;
- одновременные `register()` и `next()`;
- unit- и concurrent-тесты.

Сначала выбери модель нагрузки:

- если серверы почти не меняются, а чтений много, подходит copy-on-write;
- если регистрации часты, можно защищать обычную коллекцию lock;
- если главное — уникальность и частые изменения, стоит рассмотреть concurrent set;
- счётчик round-robin можно обновлять атомарно, но это не делает автоматически согласованными счётчик и изменяемый список.

Последний пункт — типичная ловушка композиции. Даже `AtomicInteger` и потокобезопасная коллекция по отдельности не гарантируют корректность всей операции `index → size → get` при параллельном изменении размера.

Вопросы, которые стоит проговорить:

- почему `Collections.synchronizedList()` не защищает составную операцию без внешнего `synchronized`;
- когда `CopyOnWriteArrayList` оправдывает копирование;
- чем `ConcurrentHashMap.newKeySet()` помогает с уникальностью;
- как обработать переполнение `AtomicInteger`;
- какое поведение ожидается, если список пуст;
- нужна ли линейризуемость между `register()` и `next()`.

## 5. `volatile`, atomics и Java Memory Model

Короткие вопросы обычно проверяют границы гарантий:

- `volatile` обеспечивает visibility и запрещает некоторые переупорядочивания, но не превращает составную операцию в атомарную;
- `AtomicInteger.incrementAndGet()` выполняет атомарное обновление, обычно через CAS;
- `LongAdder` масштабируется при частых конкурентных обновлениях, но получение суммы не является атомарным снимком всех ячеек;
- корректный double-checked locking требует `volatile`, чтобы ссылка не стала видна до завершения конструирования;
- выход из `synchronized`-блока happens-before последующего входа в блок на том же мониторе.

Будь готова объяснить на коде, почему это неверно:

```java
private volatile int counter;

void increment() {
    counter++;
}
```

Инкремент состоит из чтения, вычисления и записи. Два потока могут прочитать одно значение и записать одинаковый результат.

## 6. Пулы потоков и асинхронность

Эта группа встречается как продолжение разговора о параллельной обработке:

- `Runnable` не возвращает результат и не объявляет checked exception, `Callable` возвращает значение и может выбросить исключение;
- `ThreadPoolExecutor` ограничивает создание потоков через размеры pool, очередь и политику отказа;
- безразмерная очередь может скрыть перегрузку ростом latency и памяти;
- `CompletableFuture` без явно переданного executor обычно использует common `ForkJoinPool`;
- блокирующие операции в общем pool могут занять его workers;
- исключения обрабатываются через `handle`, `exceptionally` или `whenComplete`, но семантика этих методов различается.

На интервью связывай выбор pool с типом нагрузки: CPU-bound, blocking I/O, лимит внешней системы и требуемый backpressure.

## 7. Concurrency на уровне базы данных

После in-memory реализации часто спрашивают, как перенести перевод в реляционную базу.

### Pessimistic locking

`Pessimistic locking` (пессимистическая блокировка) предполагает конфликт заранее и блокирует строки, например через `SELECT ... FOR UPDATE`. Для двух счетов строки также нужно читать в стабильном порядке. Плюсы — простой путь к строгой корректности при частых конфликтах. Минусы — ожидание, риск deadlock и длительные транзакции.

### Optimistic locking

`Optimistic locking` (оптимистическая блокировка) обнаруживает конфликт при обновлении, обычно с помощью версии:

```sql
UPDATE account
SET balance = balance - :amount,
    version = version + 1
WHERE id = :id
  AND version = :expected_version
  AND balance >= :amount;
```

Ноль обновлённых строк означает конфликт или недостаток средств. Приложение должно различить исходы и решить, можно ли повторить операцию. Подход хорош при редких конфликтах, но retries увеличивают нагрузку, а перевод двух счетов всё равно должен выполняться внутри одной транзакции.

### Уровни изоляции

Нужно уметь объяснить не только названия уровней, но и аномалии:

- dirty read;
- non-repeatable read;
- phantom read;
- lost update;
- write skew.

Вопрос «какой isolation level выбрать?» не имеет универсального ответа без конкретной СУБД и формы запросов. Название уровня само по себе не заменяет анализ locks, MVCC, условий `UPDATE` и ограничений схемы.

Типовые дополнительные вопросы:

1. Optimistic или pessimistic lock для денег — при какой частоте конфликтов?
2. Поможет ли `READ COMMITTED` от двойного списания?
3. Зачем `SELECT FOR UPDATE`, если есть атомарный условный `UPDATE`?
4. Как избежать deadlock при блокировке двух строк?
5. Что произойдёт после таймаута или отката транзакции?
6. Как сделать повтор запроса идемпотентным?

## 8. Как тестировать конкурентное решение

Обычный последовательный unit-тест не доказывает потокобезопасность. Минимальный тест должен одновременно запускать несколько операций и проверять инварианты после их завершения.

```java
int workers = 20;
ExecutorService pool = Executors.newFixedThreadPool(workers);
CountDownLatch ready = new CountDownLatch(workers);
CountDownLatch start = new CountDownLatch(1);
List<Future<?>> futures = new ArrayList<>();

for (int i = 0; i < workers; i++) {
    futures.add(pool.submit(() -> {
        ready.countDown();
        start.await();
        transfer(a, b, 1);
        return null;
    }));
}

ready.await();
start.countDown();

for (Future<?> future : futures) {
    future.get();
}

assertEquals(initialTotal, a.balance() + b.balance());
```

`CountDownLatch` сближает моменты старта, но не гарантирует конкретное чередование. Такой тест способен обнаружить проблему, а отсутствие падения не доказывает её отсутствие. Полезно также:

- много раз повторять сценарий;
- задавать timeout, чтобы заметить deadlock;
- тестировать встречные переводы;
- собирать исключения из всех `Future`;
- проверять сумму, неотрицательность и ожидаемое число успешных операций;
- отделять correctness-тест от load-теста.

## 9. Короткие вопросы для самопроверки

1. Почему потокобезопасные `getBalance()` и `setBalance()` не делают перевод потокобезопасным?
2. Какие данные должны входить в одну границу атомарности?
3. Почему два account locks создают риск deadlock?
4. Как стабильный порядок locks устраняет цикл ожидания?
5. Чем `synchronized` на сервисе хуже locks на счетах?
6. Что даёт `tryLock()`, и какие новые проблемы оно создаёт?
7. Почему `volatile int` не подходит для конкурентного инкремента?
8. Когда `LongAdder` лучше `AtomicLong`, а когда хуже?
9. Почему concurrent collection не делает любую цепочку вызовов атомарной?
10. Что изменится, если authoritative balance находится в PostgreSQL?
11. Когда optimistic locking выгоднее pessimistic?
12. Какие инварианты должен проверять concurrent-тест перевода?

## 10. План подготовки

Если времени мало, двигайся в таком порядке:

1. Реализуй `transfer()` с двумя locks и объясни каждый инвариант.
2. Воспроизведи deadlock встречными переводами и исправь порядком locks.
3. Напиши concurrent-тест и добавь timeout.
4. Реализуй load balancer с регистрацией, лимитом, уникальностью и round-robin.
5. Повтори `synchronized`, `ReentrantLock`, `volatile`, atomics и happens-before.
6. Перенеси перевод в SQL с pessimistic, затем optimistic locking.
7. Потренируйся находить check-then-act и read-modify-write в незнакомом коде.

## Открытые источники

- [Официальное руководство Revolut для Java-интервью](https://www.revolut.com/blog/post/how-to-ace-your-java-interview-at-revolut/)
- [Отчёт кандидата: перевод между счетами, Java locks и SQL](https://leetcode.com/discuss/post/2187343/Revolut-or-Senior-Software-Engineer-or-India-or-June-2021-Reject/)
- [Отчёт кандидата: двойной `synchronized`, isolation levels и pessimistic locking](https://www.jointaro.com/interviews/companies/revolut/experiences/java-backend-engineer-porto-oporto-april-1-2021-no-offer-neutral-fcdb13ad/)
- [Отчёт кандидата: поиск concurrency-багов и потокобезопасный перевод](https://www.jointaro.com/interviews/companies/revolut/experiences/software-engineer-java-developer-poland-august-1-2024-no-offer-negative-38007d04/)
- [Отчёт кандидата: production-ready load balancer](https://leetcode.com/discuss/post/5670371/feedback-Needed-on-Load-Balancer-Implementation-for-Revolut-Senior-Engineer-Role/)
- [Публичное тестовое задание Revolut: API переводов между счетами](https://github.com/peshrus/revolut-interview-backend-2019)

Источники описывают разные годы, команды и уровни. Они подтверждают повторяющиеся темы, но не гарантируют конкретное задание на следующем интервью.

---

← [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) · [Оглавление](../README.md) →
