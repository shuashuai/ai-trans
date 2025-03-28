'use client';

import Image from "next/image";
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import * as yaml from 'js-yaml';
import { marked } from 'marked';

type FileType = 'yaml' | 'markdown';

interface TranslationRule {
  content: string;
  isCustom: boolean;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType>('yaml');
  const [customRules, setCustomRules] = useState<string>('');
  const [translationProgress, setTranslationProgress] = useState<number>(0);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<string>('Default');
  const [accumulatedTranslations, setAccumulatedTranslations] = useState<Map<string, string>>(new Map());
  const [currentBatchItems, setCurrentBatchItems] = useState<{ text: string; path: string[] }[]>([]);
  const [currentBatchTranslations, setCurrentBatchTranslations] = useState<Map<string, string>>(new Map());

  const languageOptions = [
    { label: 'Default', value: 'Default' },
    { label: 'English', value: 'en_US'},
    { label: 'Español', value: 'es_ES' },
    { label: 'Português(BR)', value: 'pt_BR' },
    { label: 'Português', value: 'pt_PT' },
    { label: 'Deutsch', value: 'de_DE' },
    { label: 'Français', value: 'fr_FR' },
    { label: '日本語', value: 'ja_JP' },
    { label: 'Italiano', value: 'it_IT' },
    { label: 'Русский', value: 'ru_RU' },
    { label: '简体中文', value: 'zh_CN'},
    { label: '繁體中文', value: 'zh_TW' },
    { label: '한국어', value: 'ko_KR' },
    { label: 'Tiếng Việt', value: 'vi_VN' },
    { label: 'Slovak', value: 'sk_SK' },
    { label: 'فارسی', value: 'fa_IR' }
  ];

  const baseRules = [
    '确保译文通顺、准确、符合目标语言表达习惯',
    '{{}} 中的的内容保持原样不翻译， 例如 {{ count }}, 直接返回  {{ count }}',
    '必须返回相同数量的翻译结果',
    '注意如果文案中部分内容如果前后留有空格，翻译的时候需要保留这些空格，例如： 这里有 10 个苹果、这是 API 交口、1 秒后',
    '翻译内容中有不同类型的字符时自动添加空格，如数字与文字，文字与字母，数字与字母等',
    '翻译内容中有 \n 换行符的时候，返回的内容自动加上引号，保留换行符',
    '技术术语（如 API、SDK、HTTP 等）保持大写',
    '变量名、函数名、类名等编程相关的标识符保持原样',
    '文件路径、URL、邮箱地址等保持原样',
    '版本号、数字标识等保持原样',
    '特殊标记（如 HTML 标签、Markdown 标记）保持原样',
    '文案中有部分内容是日期格式，例如 MMM D，翻译成MM 月 DD 日；MMM D, YYYY 翻译成 YYYY 年 MM 月 DD 日； 这些日期的表达式中其中 MMM 是月份，D 是日期，YYYY 是年份，翻译的时候根据目标语言的日期习惯翻译成对应的格式'
  ];

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/yaml': ['.yaml', '.yml'],
      'text/markdown': ['.md', '.markdown']
    },
    multiple: false
  });

  const handleTranslate = async () => {
    if (!file) return;
    setTranslationProgress(0);
    setIsTranslating(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const fileContent = await file.text();
      let contentToTranslate: { text: string; path: string[] }[] = [];
      let originalStructure: any;

      if (fileType === 'yaml') {
        originalStructure = yaml.load(fileContent) as Record<string, any>;
        // 提取需要翻译的内容和路径
        const extractWithPath = (obj: Record<string, any>, path: string[] = []) => {
          for (const key in obj) {
            const currentPath = [...path, key];
            if (typeof obj[key] === 'string' && obj[key].trim()) {
              contentToTranslate.push({
                text: obj[key],
                path: currentPath
              });
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
              extractWithPath(obj[key], currentPath);
            }
          }
        };
        extractWithPath(originalStructure);
      } else {
        const tokens = marked.lexer(fileContent);
        let index = 0;
        const extractFromMarkdown = (token: any) => {
          if (token.type === 'text' || token.type === 'paragraph') {
            contentToTranslate.push({
              text: token.text,
              path: [`${index++}`]
            });
          } else if (token.tokens) {
            token.tokens.forEach(extractFromMarkdown);
          }
        };
        tokens.forEach(extractFromMarkdown);
      }

      const rules: TranslationRule[] = [
        ...baseRules.map(rule => ({ content: rule, isCustom: false })),
        ...customRules
          .split('\n')
          .filter(rule => rule.trim())
          .map(rule => ({ content: rule, isCustom: true }))
      ];

      const systemPrompt = `你是一个专业的翻译助手，请按照以下规则进行翻译：\n${rules.map(r => r.content).join('\n')}\n\n请将以下内容翻译成${targetLanguage === 'Default' ? '中文' : targetLanguage}：`;

      const batchSize = 30;
      const batches = Math.ceil(contentToTranslate.length / batchSize);
      let translatedContent = new Map<string, string>();

      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, contentToTranslate.length);
        const batchItems = contentToTranslate.slice(start, end);
        setCurrentBatchItems(batchItems);
        setCurrentBatchTranslations(new Map());

        try {
          const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              texts: batchItems.map(item => item.text),
              systemPrompt,
              targetLanguage,
              batchIndex,
              totalBatches: batches
            })
          });

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = JSON.parse(line.slice(6));

              if (data.translatedText && Array.isArray(data.translatedText)) {
                const validTranslations = data.translatedText.filter((text: string) => text && text.trim());
                validTranslations.forEach((text: string, i: number) => {
                  if (batchItems[i]) {
                    const cleanedText = text.trim().replace(/^"(.*)"$/s, '$1').replace(/\n/g, '\n');
                    const pathKey = batchItems[i].path.join('.');
                    translatedContent.set(pathKey, cleanedText);
                    currentBatchTranslations.set(pathKey, cleanedText);
                    setCurrentBatchTranslations(new Map(currentBatchTranslations));
                    const newTranslations = new Map([...Array.from(accumulatedTranslations), ...Array.from(translatedContent)]);
                    setAccumulatedTranslations(newTranslations);

                    // 构建预览内容
                    if (fileType === 'yaml') {
                      let previewYaml = {};
                      // 只显示已翻译和当前批次的内容
                      const displayTranslations = new Map([
                        ...Array.from(accumulatedTranslations),
                        ...Array.from(currentBatchTranslations)
                      ]);
                      
                      // 使用显示的翻译结果构建预览
                      for (const [path, translation] of displayTranslations.entries()) {
                        const pathArray = path.split('.');
                        let current = previewYaml;
                        pathArray.slice(0, -1).forEach(segment => {
                          if (!current[segment]) {
                            current[segment] = {};
                          }
                          current = current[segment];
                        });
                        current[pathArray[pathArray.length - 1]] = translation;
                      }
                      setPreviewContent(yaml.dump(previewYaml, { indent: 2, quotingType: '"', lineWidth: -1, forceQuotes: true }));
                    } else {
                      // 对于 Markdown，只显示已翻译和当前批次的内容
                      const displayTranslations = new Map([
                        ...Array.from(accumulatedTranslations),
                        ...Array.from(currentBatchTranslations)
                      ]);
                      
                      const previewContent = [
                        ...Array.from(displayTranslations.entries())
                          .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                          .map(([path, translation]) => {
                            const originalText = contentToTranslate.find(item => item.path.join('.') === path)?.text;
                            return `${originalText}\n\n${translation}\n---`;
                          })
                      ].join('\n');
                      setPreviewContent(previewContent);
                    }
                  }
                });
              }
            }
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          setTranslationProgress(((end) / contentToTranslate.length) * 100);
        } catch (error) {
          console.error('Translation API error:', error);
          batchItems.forEach(item => {
            translatedContent.set(item.path.join('.'), item.text);
          });
        }
      }
    } catch (error) {
      console.error('Translation error:', error);
      alert('翻译过程中发生错误');
    } finally {
      setIsTranslating(false);
      setTranslationProgress(100);
    }
  };

  // 从YAML中提取需要翻译的值
  const extractValuesFromYaml = (obj: Record<string, any>): string[] => {
    const values: string[] = [];
    const traverse = (o: Record<string, any>) => {
      for (const key in o) {
        if (typeof o[key] === 'string') {
          values.push(o[key]);
        } else if (typeof o[key] === 'object' && o[key] !== null) {
          traverse(o[key]);
        }
      }
    };
    traverse(obj);
    return values;
  };

  // 从Markdown中提取需要翻译的文本
  const extractValuesFromMarkdown = (content: string): string[] => {
    const tokens = marked.lexer(content);
    const values: string[] = [];
    
    const extractText = (token: any) => {
      if (token.type === 'text' || token.type === 'paragraph') {
        values.push(token.text);
      } else if (token.tokens) {
        token.tokens.forEach(extractText);
      }
    };

    tokens.forEach(extractText);
    return values;
  };

  const handleStopTranslation = () => {
    // TODO: 实现停止翻译逻辑
    setIsTranslating(false);
  };

  const handleDownload = () => {
    if (!previewContent) return;

    const blob = new Blob([previewContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_${file?.name}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center">AI 翻译工具</h1>

        {/* 文件上传区域 */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <Image
              src="/file.svg"
              alt="上传文件"
              width={64}
              height={64}
              className="opacity-50"
            />
            {file ? (
              <p className="text-lg">已选择文件: {file.name}</p>
            ) : (
              <p className="text-lg text-gray-500">拖拽文件到此处，或点击选择文件</p>
            )}
          </div>
        </div>

        {/* 文件类型选择 */}
        <div className="flex gap-4 justify-center">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="yaml"
              checked={fileType === 'yaml'}
              onChange={(e) => setFileType(e.target.value as FileType)}
            />
            YAML
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="markdown"
              checked={fileType === 'markdown'}
              onChange={(e) => setFileType(e.target.value as FileType)}
            />
            Markdown
          </label>
        </div>

        {/* 语言选择下拉框 */}
        <div className="space-y-2">
          <div className="flex flex-col space-y-2">
            <label htmlFor="targetLanguage" className="text-sm font-medium text-gray-700">选择需要翻译的语言</label>
            <select
              id="targetLanguage"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 自定义规则输入 */}
        <div className="space-y-2">
          <label className="block font-medium">自定义翻译规则（每行一个）：</label>
          <textarea
            className="w-full h-32 p-2 border rounded-lg"
            value={customRules}
            onChange={(e) => setCustomRules(e.target.value)}
            placeholder="在此输入自定义翻译规则..."
          />
        </div>

        {/* 翻译按钮和进度 */}
        <div className="space-y-4">
          <div className="flex justify-center gap-4">
            <button
              className={`px-6 py-2 rounded-lg ${isTranslating
                ? 'bg-gray-500 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600'} text-white`}
              onClick={handleTranslate}
              disabled={isTranslating || !file}
            >
              开始翻译
            </button>
            {isTranslating && (
              <button
                className="px-6 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white"
                onClick={handleStopTranslation}
              >
                停止翻译
              </button>
            )}
          </div>
          {isTranslating && (
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${translationProgress}%` }}
              />
            </div>
          )}
        </div>

        {/* 预览区域 */}
        {previewContent && (
          <div className="space-y-4">
            <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: '800px' }}>
              <pre className="whitespace-pre-wrap">{previewContent}</pre>
            </div>
            <div className="flex justify-center">
              <button
                className="px-6 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white"
                onClick={handleDownload}
              >
                下载翻译结果
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

  // 更新YAML文件中的值
  const updateYamlValues = (original: Record<string, any>, sourceValues: string[], translatedValues: string[]): Record<string, any> => {
    const result = JSON.parse(JSON.stringify(original));
  let valueIndex = 0;

    const traverse = (obj: Record<string, any>) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          const sourceIndex = sourceValues.indexOf(obj[key]);
          if (sourceIndex !== -1 && translatedValues[sourceIndex]) {
            obj[key] = translatedValues[sourceIndex];
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          traverse(obj[key]);
        }
      }
    };

    traverse(result);
    return result;
  };

  // 更新Markdown文件中的内容
  const updateMarkdownContent = (original: string, sourceValues: string[], translatedValues: string[]): string => {
    let result = original;
    for (let i = 0; i < sourceValues.length; i++) {
      if (translatedValues[i]) {
        result = result.replace(sourceValues[i], translatedValues[i]);
      }
    }
    return result;
  };
