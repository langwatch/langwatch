import os
import ast
import re
from collections import defaultdict

evaluators_dir = '../evaluators'
mdx_file_path = '../documentation/documentation/evaluators.mdx'

class EvaluatorDefinitions:
    def __init__(self, name, description, category, docs_url, is_guardrail):
        self.name = name
        self.description = description
        self.category = category
        self.docs_url = docs_url
        self.is_guardrail = is_guardrail

def get_evaluator_classes(module):
    return [cls for name, cls in module.__dict__.items() if isinstance(cls, type)]

def get_evaluator_definitions(cls):
    return EvaluatorDefinitions(
        name=cls.name,
        description=cls.__doc__.strip() if cls.__doc__ else "Description not found",
        category=getattr(cls, 'category', 'Other'),
        docs_url=getattr(cls, 'docs_url', ''),
        is_guardrail=getattr(cls, 'is_guardrail', False)
    )

def load_evaluator_packages():
    packages = {}
    for root, dirs, files in os.walk(evaluators_dir):
        for dir_name in dirs:
            if dir_name.startswith('langevals_'):
                subfolder_path = os.path.join(root, dir_name)
                package_name = dir_name.replace('langevals_', '')
                try:
                    module = __import__(f"{evaluators_dir}.{package_name}", fromlist=[None])
                    packages[package_name] = module
                except ImportError as e:
                    print(f"Could not import module {package_name}: {e}")
    return packages

def extract_evaluator_info(file_path):
    with open(file_path, 'r', encoding='utf-8') as file:
        tree = ast.parse(file.read(), filename=file_path)

    class_info = {
        'name': None,
        'description': None,
        'category': 'Other',
        'docs_url': '',
        'is_guardrail': False
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_info['description'] = ast.get_docstring(node)
            for child in node.body:
                if isinstance(child, ast.Assign):
                    for target in child.targets:
                        if isinstance(target, ast.Name):
                            if target.id == 'category' and isinstance(child.value, ast.Str):
                                class_info['category'] = child.value.s
                            elif target.id == 'name' and isinstance(child.value, ast.Str):
                                class_info['name'] = child.value.s
                            elif target.id == 'docs_url' and isinstance(child.value, ast.Str):
                                class_info['docs_url'] = child.value.s
                            elif target.id == 'is_guardrail' and isinstance(child.value, ast.NameConstant):
                                class_info['is_guardrail'] = child.value.value

    if class_info['description']:
        print(class_info['description'])
        class_info['description'] = class_info['description'].replace('\n', ' ')
        print(class_info['description'])

    return class_info if class_info['name'] else None

def wrap_text(text, width=80):
    lines = []
    for paragraph in text.split('\n'):
        while len(paragraph) > width:
            space_index = paragraph[:width].rfind(' ')
            if space_index == -1:
                space_index = width
            lines.append(paragraph[:space_index])
            paragraph = paragraph[space_index:].strip()
        lines.append(paragraph)
    return '\n'.join(lines)

evaluator_descriptions = []
for root, dirs, files in os.walk(evaluators_dir):
    for dir_name in dirs:
        if dir_name.startswith('langevals_'):
            subfolder_path = os.path.join(root, dir_name)
            print(f"Processing directory: {subfolder_path}")  # Debug statement
            for sub_root, _, sub_files in os.walk(subfolder_path):
                for file in sub_files:
                    if file.endswith('.py'):
                        file_path = os.path.join(sub_root, file)
                        print(f"Processing file: {file_path}")  # Debug statement
                        evaluator_info = extract_evaluator_info(file_path)
                        if evaluator_info:
                            evaluator_descriptions.append(evaluator_info)
                            print(f"Extracted info: {evaluator_info}")  # Debug statement


new_accordion_group_content = "<AccordionGroup>\n"

categories = defaultdict(list)
for evaluator in evaluator_descriptions:
    categories[evaluator['category']].append({
        "name": evaluator['name'],
        "description": wrap_text(evaluator['description']),
        "link": f"/evaluators/{evaluator['name'].replace(' ', '-').lower()}"
    })

for category, evaluators in categories.items():
    new_accordion_group_content += f"  <Accordion title=\"{category.capitalize()}\">\n"
    new_accordion_group_content += "    | Evaluator                                | Description                |\n"
    new_accordion_group_content += "    | -----------------------------------------|----------------------------|\n"
    for evaluator in evaluators:
        new_accordion_group_content += f"    | [{evaluator['name']}]({evaluator['link']}) | {evaluator['description']} |\n"
    new_accordion_group_content += "  </Accordion>\n"

new_accordion_group_content += "</AccordionGroup>\n"


with open(mdx_file_path, 'r', encoding='utf-8') as mdx_file:
    mdx_content = mdx_file.read()


updated_mdx_content = re.sub(
    r'<AccordionGroup>.*</AccordionGroup>',
    new_accordion_group_content,
    mdx_content,
    flags=re.DOTALL
)


with open(mdx_file_path, 'w', encoding='utf-8') as mdx_file:
    mdx_file.write(updated_mdx_content)

print("MDX file updated successfully.")
