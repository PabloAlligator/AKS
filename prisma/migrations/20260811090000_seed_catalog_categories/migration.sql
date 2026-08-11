-- Seed the three public catalog groups. They can be renamed or hidden in the admin panel.
INSERT INTO "ProductCategory" ("name", "slug", "description", "sortOrder", "updatedAt") VALUES
    ('Масла', 'masla', 'Моторные и трансмиссионные масла', 10, CURRENT_TIMESTAMP),
    ('Катализаторы', 'katalizatory', 'Катализаторы и компоненты выхлопной системы', 20, CURRENT_TIMESTAMP),
    ('Расходники', 'raskhodniki', 'Фильтры, свечи и другие расходные материалы', 30, CURRENT_TIMESTAMP);
