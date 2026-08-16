# Fork/Join: разделяем вычисление на подзадачи

> Рекурсивное деление CPU-bound задачи, `ForkJoinPool` и work stealing

← [Executor: задача отдельно от потока](./18-executor.md) · [Виртуальные потоки в Java](./18-virtual-threads.md) →

## Задача перед теорией: сумма большого массива

В памяти находится массив из ста миллионов чисел. Нужно вычислить его сумму как можно быстрее на многоядерном процессоре.

Последовательный цикл корректен, но использует только одно ядро:

```java
long result = 0;
for (long value : values) {
    result += value;
}
```

Задача CPU-bound (ограниченная процессором): она почти не ждёт сеть или диск. При этом массив естественно делится на независимые диапазоны:

```text
[                 весь массив                 ]
             /                    \
[         левая половина         ] [ правая половина ]
        /            \                  /       \
   ещё меньше    ещё меньше         ...         ...
```

Каждую половину можно снова делить, пока диапазон не станет достаточно маленьким для обычного цикла. Затем частичные суммы складываются. Это divide and conquer (разделяй и властвуй).

## Какие решения можно рассмотреть

| Решение | Когда подходит | Что не совпадает с задачей |
|---|---|---|
| Один цикл | массив небольшой или операция выполняется редко | использует одно ядро |
| Фиксированный `ExecutorService` | задачи заранее известны и независимы | здесь подзадачи появляются динамически при делении |
| Virtual threads | очень много блокирующих I/O-задач | вычисления не ускоряются от дополнительных потоков |
| Fork/Join | CPU-bound работу можно рекурсивно разделить и объединить | нужно выбрать разумный размер конечной части |

Для этой задачи хорошо подходит Fork/Join Framework (фреймворк разделения и объединения задач).

## Где находится и когда появился

Основные классы входят в стандартный пакет `java.util.concurrent`:

```java
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.ForkJoinTask;
import java.util.concurrent.RecursiveAction;
import java.util.concurrent.RecursiveTask;
```

`ForkJoinPool`, `ForkJoinTask`, `RecursiveTask` и `RecursiveAction` появились в Java 7. `ForkJoinPool` реализует `ExecutorService`, но специализируется на задачах, которые порождают другие задачи.

## Карта API

```text
ExecutorService
└── ForkJoinPool       пул worker-потоков для ForkJoinTask

ForkJoinTask<V>        базовый тип задачи
├── RecursiveTask<V>  вычисляет и возвращает V
└── RecursiveAction   выполняет действие без результата
```

Для суммы нужен `RecursiveTask<Long>`, потому что каждая часть возвращает число. Для изменения пикселей изображения без возвращаемого результата подошёл бы `RecursiveAction`.

## Что означают fork и join

- `fork()` (отделить подзадачу) планирует её асинхронное выполнение;
- `join()` (дождаться и объединить) возвращает результат завершённой подзадачи;
- `compute()` описывает правило: посчитать сразу или разделить ещё раз.

Схема одной задачи выглядит так:

```text
compute(range)
    ├── range маленький → посчитать циклом
    └── range большой
            ├── fork(left)
            ├── compute(right)
            └── join(left) + rightResult
```

## Реализация RecursiveTask

```java
final class SumTask extends RecursiveTask<Long> {
    private final long[] values;
    private final int from;
    private final int to;
    private final int threshold;

    @Override
    protected Long compute() {
        if (to - from <= threshold) {
            return sumSequentially();
        }

        int middle = from + (to - from) / 2;
        SumTask left = new SumTask(values, from, middle, threshold);
        SumTask right = new SumTask(values, middle, to, threshold);

        left.fork();
        long rightResult = right.compute();
        return left.join() + rightResult;
    }
}
```

Текущий worker отправляет левую часть в пул, а правую считает сам. Так он не простаивает после создания подзадач. В конце `join()` даёт сумму левой части.

`threshold` (порог дробления) отвечает за granularity (гранулярность, размер подзадачи):

- слишком маленький порог создаёт огромное количество объектов и расходов на планирование;
- слишком большой порог создаёт мало подзадач и не загружает все ядра;
- подходящее значение находят измерениями на реальных данных и оборудовании.

## Как запускается корневая задача

```java
ForkJoinPool pool = new ForkJoinPool();
try {
    long sum = pool.invoke(
        new SumTask(values, 0, values.length, threshold)
    );
} finally {
    pool.shutdown();
}
```

`invoke()` отправляет корневую задачу и ждёт её результат. Конструктор без аргументов выбирает уровень parallelism (параллелизма) на основе числа доступных процессоров.

## Как работает work stealing

Work stealing (перехват работы; буквально «кража работы») помогает распределять динамически возникающие подзадачи. У каждого worker есть собственная очередь. Если один worker закончил свою работу, он забирает доступную задачу у занятого worker.

```text
worker A: [task][task][task][task]
worker B: []
             ↑
       B забирает задачу у A
```

Это особенно полезно, когда ветви вычисления имеют разную стоимость: свободный поток не обязан ждать, пока самый загруженный закончит всю свою очередь.

## Когда Fork/Join не подходит

Не выбирай его автоматически для любой многопоточности:

- блокирующие HTTP-, JDBC- и файловые вызовы занимают worker ожиданием; для множества таких операций чаще подходят virtual threads;
- слишком маленькая задача может выполниться медленнее из-за расходов на деление;
- вычисление, которое нельзя разделить на независимые части, не получает пользы;
- общее изменяемое состояние между подзадачами возвращает проблемы гонок и синхронизации.

`ForkJoinPool.commonPool()` разделяется разными пользователями внутри процесса, включая parallel streams. Длительная блокировка или тяжёлая задача в общем пуле может повлиять на чужую работу, поэтому принадлежность пула должна быть осознанной.

## Как выбрать между тремя инструментами

```text
Заранее известные независимые задачи → обычный ExecutorService
Рекурсивно делимое CPU-вычисление   → Fork/Join
Тысячи блокирующих I/O-операций     → virtual threads
```

Это не взаимоисключающие технологии, а разные политики для разных форм работы.

## В учебном проекте

Запускаемый пример находится в отдельном Maven-модуле:

- [создание и завершение `ForkJoinPool`](https://github.com/tantarin/java-concurrency-examples/blob/3ca53f8a3850707adb83ed769368ec7fd4ddbd9c/parallelism/fork-join-array-sum/src/main/java/io/github/tantarin/concurrency/forkjoin/ParallelArraySum.java#L11-L23)
- [`RecursiveTask`, порог и рекурсивное деление](https://github.com/tantarin/java-concurrency-examples/blob/3ca53f8a3850707adb83ed769368ec7fd4ddbd9c/parallelism/fork-join-array-sum/src/main/java/io/github/tantarin/concurrency/forkjoin/ParallelArraySum.java#L25-L59)
- [`fork()`, локальное вычисление и `join()`](https://github.com/tantarin/java-concurrency-examples/blob/3ca53f8a3850707adb83ed769368ec7fd4ddbd9c/parallelism/fork-join-array-sum/src/main/java/io/github/tantarin/concurrency/forkjoin/ParallelArraySum.java#L44-L50)
- [тест результата и граничных случаев](https://github.com/tantarin/java-concurrency-examples/blob/3ca53f8a3850707adb83ed769368ec7fd4ddbd9c/parallelism/fork-join-array-sum/src/test/java/io/github/tantarin/concurrency/forkjoin/ParallelArraySumTest.java#L10-L30)

## Проверь себя

1. Почему virtual threads не ускорят суммирование массива?
2. Чем `RecursiveTask` отличается от `RecursiveAction`?
3. Что произойдёт, если сделать `threshold` равным единице?
4. Зачем одну половину считать через `compute()`, а не вызывать `fork()` для обеих и сразу ждать?
5. Почему блокирующий сетевой вызов внутри каждой подзадачи — плохой сценарий для этого примера?

## Упражнение

Добавь `RecursiveTask<Long>`, который ищет максимальный элемент массива. Сначала проверь корректность тестом, затем измерь несколько значений `threshold`. Сравни время с последовательным циклом на маленьком и большом массивах; не делай вывод об ускорении по одному запуску.

> **Главная мысль:** Fork/Join подходит, когда CPU-bound задачу можно рекурсивно делить на независимые части, а затем объединять результаты. `ForkJoinPool` распределяет возникающие подзадачи через work stealing, но само деление должно быть достаточно крупным, чтобы окупить накладные расходы.

## Первоисточники

- [Java API: `ForkJoinPool`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ForkJoinPool.html)
- [Java API: `ForkJoinTask`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ForkJoinTask.html)
- [Java API: `RecursiveTask`](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/RecursiveTask.html)

## Дальше

Fork/Join помогает загрузить ядра делимым вычислением. Теперь рассмотрим противоположный профиль: тысячи задач почти не вычисляют, а в основном ждут I/O. Для него в Java появились virtual threads.

---

← [Executor: задача отдельно от потока](./18-executor.md) · [Виртуальные потоки в Java](./18-virtual-threads.md) →
