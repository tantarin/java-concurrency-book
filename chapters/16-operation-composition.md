# Почему get и put недостаточно

> Композиция операций

← [Зачем ConcurrentHashMap](./15-concurrent-hash-map.md) · [Атомарные compute и merge](./17-compute-and-merge.md) →

Вернём прежний код, но теперь с `ConcurrentHashMap`:

```java
Integer value = views.get("car:123");
views.put("car:123", value + 1);
```

`get()` безопасен, и `put()` безопасен. Но между ними другой поток может изменить тот же ключ:

```java
Thread 1: get → 0
Thread 2: get → 0
Thread 1: put → 1
Thread 2: put → 1
```

Это та же [race condition](./05-race-condition-details.md), что была у поля `count`. Коллекция не знает, что два вызова и вычисление между ними образуют одно увеличение.

> Композиция thread-safe операций не обязательно thread-safe. Границу атомарности нужно выразить явно.

## Дальше

ConcurrentHashMap предоставляет готовые составные операции. Используем одну из них вместо пары get и put.

---

← [Зачем ConcurrentHashMap](./15-concurrent-hash-map.md) · [Атомарные compute и merge](./17-compute-and-merge.md) →
