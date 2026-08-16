# Почему ConcurrentHashMap.computeIfAbsent() не делает весь код потокобезопасным

> Атомарность операции с Map заканчивается на границе её контракта

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Runnable vs. Callable](./18-runnable-vs-callable.md) →

## Сначала точный ответ

`ConcurrentHashMap.computeIfAbsent()` потокобезопасен: проверка отсутствия ключа, вычисление и установка ненулевого значения выполняются атомарно для этого ключа.

Но метод гарантирует безопасность только своей операции с map. Он не делает автоматически потокобезопасными:

- объект, сохранённый как value;
- действия после возврата метода;
- побочные эффекты mapping function;
- бизнес-операцию, затрагивающую несколько ключей или другие структуры.

Поэтому точнее спрашивать не «потокобезопасен ли `computeIfAbsent()`», а «какую границу покрывает его атомарность?».

## Задача: теги пользователей

Нужно хранить множество тегов для каждого пользователя. На первый взгляд решение выглядит естественно:

```java
ConcurrentHashMap<String, List<String>> tags =
    new ConcurrentHashMap<>();

tags.computeIfAbsent(
    userId,
    ignored -> new ArrayList<>()
).add(tag);
```

`computeIfAbsent()` действительно гарантирует, что конкурентные потоки не установят два разных списка для одного отсутствующего `userId`. Но затем метод возвращается, и каждый поток отдельно вызывает:

```java
sharedArrayList.add(tag);
```

`ArrayList` не поддерживает конкурентные изменения. Добавления могут потеряться, внутреннее состояние может быть повреждено, а чтение во время изменения не получает безопасного контракта.

```text
атомарно внутри ConcurrentHashMap
┌────────────────────────────────────────────┐
│ computeIfAbsent(userId, new ArrayList())   │
└────────────────────────────────────────────┘
                                             ↓ возвращён общий List
Thread 1: list.add("java")   ┐
Thread 2: list.add("locks")  ├─ уже не операция ConcurrentHashMap
Thread 3: list.add("jmm")    ┘
```

## Какой контракт даёт ConcurrentHashMap

Упрощённая логика:

```text
если key уже связан с ненулевым value
    → вернуть существующий value
иначе
    → применить mappingFunction
    → если результат не null, атомарно установить его
    → вернуть результат
```

Mapping function (функция вычисления значения) применяется атомарно. Пока вычисление для ключа не закончено, некоторые другие обновления map могут ждать. Поэтому функция должна быть короткой и простой.

Это сильнее общего default-метода `Map.computeIfAbsent()`: интерфейс `Map` сам по себе не обещает синхронизацию. Атомарные гарантии нужно читать в документации конкретной реализации — здесь `ConcurrentHashMap`.

## Ошибка №1: изменяемое непотокобезопасное value

Опасны не только списки:

```java
map.computeIfAbsent(key, ignored -> new HashSet<>()).add(value);
map.computeIfAbsent(key, ignored -> new HashMap<>()).put(a, b);
map.computeIfAbsent(key, ignored -> new Counter()).increment();
```

Concurrent map безопасно хранит ссылку. Безопасность методов объекта по этой ссылке определяется классом value и общим протоколом доступа.

```text
ConcurrentHashMap<K, V> потокобезопасен
              ≠
каждый произвольный V потокобезопасен
```

## Решение №1: concurrent value

Если value должен изменяться конкурентно, выбери потокобезопасный тип:

```java
ConcurrentHashMap<String, Set<String>> tags =
    new ConcurrentHashMap<>();

tags.computeIfAbsent(
    userId,
    ignored -> ConcurrentHashMap.newKeySet()
).add(tag);
```

Теперь две части имеют собственные гарантии:

- `computeIfAbsent()` безопасно регистрирует set для ключа;
- concurrent set безопасно принимает параллельные `add()`.

Для счётчиков документация `ConcurrentHashMap` приводит похожий шаблон с `LongAdder`:

```java
frequencies
    .computeIfAbsent(word, ignored -> new LongAdder())
    .increment();
```

## Решение №2: immutable value и атомарная замена

Другой протокол — не изменять опубликованный список. Каждое обновление создаёт новый immutable snapshot (неизменяемый снимок):

```java
tags.compute(userId, (ignored, current) -> {
    List<String> updated = current == null
        ? new ArrayList<>()
        : new ArrayList<>(current);
    updated.add(tag);
    return Collections.unmodifiableList(updated);
});
```

Всё read–modify–write (чтение–изменение–запись) выполняется внутри атомарного `compute()` для ключа. Читатели получают список, который после публикации не меняется.

Цена — создание копии при каждом обновлении. Такой вариант подходит, когда чтений много, списки умеренного размера, а обновления сравнительно редки.

## Почему synchronizedList не всегда достаточно

Можно хранить:

```java
Collections.synchronizedList(new ArrayList<>())
```

Отдельный `add()` станет безопасным. Но составные операции всё равно требуют протокола самого списка:

```java
if (!list.contains(tag)) {
    list.add(tag);
}
```

Между `contains()` и `add()` может вмешаться другой поток. Итерация `synchronizedList` также требует внешнего `synchronized (list)`.

Нужно выбирать решение по полной бизнес-операции, а не только по типу поля map.

## Ошибка №2: считать mapping function глобальным exactly-once

Для одного вызова и одного ключа `ConcurrentHashMap` применяет функцию атомарно и не более одного раза. Но нельзя превращать её в глобальную exactly-once operation (операцию «ровно один раз») для внешней системы:

```java
map.computeIfAbsent(id, ignored -> {
    paymentGateway.charge(card); // опасный внешний side effect
    return loadOrder(id);
});
```

Функция может выполниться снова в будущем, если:

- она вернула `null`, поэтому mapping не появился;
- она бросила исключение, поэтому mapping не появился;
- запись позднее удалили;
- другой вызов произошёл после удаления.

Кроме того, удерживать внутреннюю координацию map во время медленного сетевого вызова — плохая идея: конкурентные обновления могут ждать. Денежный платёж требует отдельного idempotency (идемпотентного) протокола внешней системы.

## Ошибка №3: рекурсивно изменять ту же map

Mapping function не должна изменять другие mappings той же `ConcurrentHashMap`:

```java
map.computeIfAbsent(keyA, ignored -> {
    map.put(keyB, valueB); // нарушает контракт
    return valueA;
});
```

Рекурсивное обновление может конфликтовать с внутренней координацией. Обнаруживаемая рекурсивная попытка, которая иначе никогда не завершилась бы, может привести к `IllegalStateException`.

Сначала вычисли необходимые внешние данные, затем выполни короткую атомарную операцию с map. Не строй внутри mapping function цепочку обновлений той же структуры.

## Ошибка №4: ожидать null в ConcurrentHashMap

`ConcurrentHashMap` не допускает `null` keys и values. Для `computeIfAbsent()` результат `null` имеет специальный смысл: mapping не создаётся.

```java
Value value = map.computeIfAbsent(key, ignored -> null);
// value == null, key всё ещё отсутствует
```

Это не кеширование `null`. Следующий вызов снова может применить функцию.

## Ошибка №5: операция затрагивает несколько ключей

Атомарность относится к одному ключу. Например, перенос значения между `from` и `to` нельзя сделать атомарным двумя отдельными вызовами:

```java
map.compute(from, debit);
map.compute(to, credit);
```

Между ними другой поток увидит промежуточное состояние. Для инварианта нескольких ключей нужен более широкий протокол: общий lock, неизменяемое агрегированное состояние, транзакция или другая модель данных.

## Как выбирать решение

| Требование | Подход |
|---|---|
| Один раз создать неизменяемое value | `computeIfAbsent()` |
| После создания конкурентно изменять value | concurrent value, например `newKeySet()` или `LongAdder` |
| Атомарно заменить значение одного ключа | `compute()` / `merge()` |
| Часто читать, редко дополнять небольшой список | immutable copy внутри `compute()` |
| Сохранить инвариант нескольких ключей | отдельная синхронизация или другая модель |
| Выполнить внешний side effect ровно один раз | отдельный idempotency/transaction protocol |

## В учебном проекте

- [антипаттерн: атомарно созданный, но небезопасно изменяемый `ArrayList`](https://github.com/tantarin/java-concurrency-examples/blob/42036bea92b3769bd27914ed489a38e0f38106e0/collections/compute-if-absent-boundaries/src/main/java/io/github/tantarin/concurrency/compute/UnsafeUserTags.java#L7-L12)
- [безопасное value через `ConcurrentHashMap.newKeySet()`](https://github.com/tantarin/java-concurrency-examples/blob/42036bea92b3769bd27914ed489a38e0f38106e0/collections/compute-if-absent-boundaries/src/main/java/io/github/tantarin/concurrency/compute/UserTags.java#L9-L20)
- [immutable snapshot внутри атомарного `compute()`](https://github.com/tantarin/java-concurrency-examples/blob/42036bea92b3769bd27914ed489a38e0f38106e0/collections/compute-if-absent-boundaries/src/main/java/io/github/tantarin/concurrency/compute/UserTags.java#L23-L35)
- [сто конкурентных обновлений обоими безопасными способами](https://github.com/tantarin/java-concurrency-examples/blob/42036bea92b3769bd27914ed489a38e0f38106e0/collections/compute-if-absent-boundaries/src/test/java/io/github/tantarin/concurrency/compute/UserTagsTest.java#L16-L33)
- [проверка mapping function для стабильного ключа](https://github.com/tantarin/java-concurrency-examples/blob/42036bea92b3769bd27914ed489a38e0f38106e0/collections/compute-if-absent-boundaries/src/test/java/io/github/tantarin/concurrency/compute/UserTagsTest.java#L35-L46)

## Проверь себя

1. Какая часть `computeIfAbsent(key, factory).add(value)` атомарна?
2. Почему безопасная публикация `ArrayList` не делает его методы потокобезопасными?
3. Когда value лучше сделать concurrent collection?
4. Чем immutable replacement через `compute()` отличается от изменения существующего списка?
5. Почему mapping function не подходит для внешнего exactly-once платежа?
6. Можно ли одной операцией `compute()` сохранить инвариант двух ключей?

## Упражнение

Реализуй индекс `ConcurrentHashMap<String, Set<Long>>`, где ключ — тег, а value — множество идентификаторов статей. Запусти сто конкурентных добавлений одного тега и проверь, что ни один id не потерян. Затем объясни контракт потокобезопасности map и set отдельно.

> **Главная мысль:** `ConcurrentHashMap.computeIfAbsent()` атомарно вычисляет и устанавливает value для ключа. После возврата метода ответственность продолжается: изменяемое value должно иметь собственный конкурентный контракт, а составная бизнес-операция — охватываться подходящим протоколом целиком.

## Первоисточники

- [Java API: `ConcurrentHashMap.computeIfAbsent()`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html#computeIfAbsent-K-java.util.function.Function-)
- [Java API: `Map.computeIfAbsent()`](https://docs.oracle.com/javase/8/docs/api/java/util/Map.html#computeIfAbsent-K-java.util.function.Function-)
- [Java API: `ConcurrentHashMap.newKeySet()`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html#newKeySet--)

## Дальше

Теперь граница атомарности concurrent map определена точно. Дальше перейдём от хранения состояния к контрактам выполняемых задач: `Runnable` и `Callable`.

---

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Runnable vs. Callable](./18-runnable-vs-callable.md) →
